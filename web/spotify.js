import { spotifyClientId } from "./firebase-config.js";
import { clearNowPlaying, loadSpotifyTokens, saveNowPlaying, saveSpotifyTokens } from "./cloud.js";

const SCOPES = "user-read-currently-playing user-read-playback-state";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const NOW_URL = "https://api.spotify.com/v1/me/player/currently-playing";

export function isSpotifyConfigured() {
  return Boolean(spotifyClientId && spotifyClientId !== "YOUR_SPOTIFY_CLIENT_ID");
}

function randomString(bytes = 32) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return Array.from(data, (b) => b.toString(16).padStart(2, "0")).join("");
}

function base64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256(value) {
  const encoded = new TextEncoder().encode(value);
  return crypto.subtle.digest("SHA-256", encoded);
}

function redirectUri() {
  if (globalThis.chrome?.identity?.getRedirectURL) {
    return chrome.identity.getRedirectURL();
  }
  return `${location.origin}/web/spotify-callback.html`;
}

export async function connectSpotify() {
  if (!isSpotifyConfigured()) {
    throw new Error("Add your Spotify client ID to web/firebase-config.js");
  }
  if (!globalThis.chrome?.identity?.launchWebAuthFlow) {
    throw new Error("Connect Spotify from the Focus Buddy extension, not a normal browser tab.");
  }

  const verifier = randomString(40);
  const challenge = base64Url(await sha256(verifier));
  const state = randomString(8);
  const params = new URLSearchParams({
    client_id: spotifyClientId,
    response_type: "code",
    redirect_uri: redirectUri(),
    scope: SCOPES,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
  });
  const url = `https://accounts.spotify.com/authorize?${params.toString()}`;

  const responseUrl = await new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, (redirected) => {
      if (chrome.runtime.lastError || !redirected) {
        reject(new Error(chrome.runtime.lastError?.message || "Spotify sign-in was cancelled."));
        return;
      }
      resolve(redirected);
    });
  });

  const redirected = new URL(responseUrl);
  const error = redirected.searchParams.get("error");
  if (error) throw new Error(error);
  const code = redirected.searchParams.get("code");
  if (!code) throw new Error("Spotify did not return an auth code.");

  const body = new URLSearchParams({
    client_id: spotifyClientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  });
  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!tokenRes.ok) throw new Error("Could not finish Spotify login.");
  const json = await tokenRes.json();
  const tokens = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || "",
    expiresAt: Date.now() + (json.expires_in || 3600) * 1000,
    tokenType: json.token_type || "Bearer",
  };
  await saveSpotifyTokens(tokens);
  if (globalThis.chrome?.storage?.local) {
    await chrome.storage.local.set({ spotifyTokens: tokens });
  }
  return tokens;
}

async function refreshTokens(current) {
  if (!current?.refreshToken) return current;
  const body = new URLSearchParams({
    client_id: spotifyClientId,
    grant_type: "refresh_token",
    refresh_token: current.refreshToken,
  });
  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!tokenRes.ok) return current;
  const json = await tokenRes.json();
  const tokens = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || current.refreshToken,
    expiresAt: Date.now() + (json.expires_in || 3600) * 1000,
    tokenType: json.token_type || current.tokenType || "Bearer",
  };
  await saveSpotifyTokens(tokens);
  if (globalThis.chrome?.storage?.local) {
    await chrome.storage.local.set({ spotifyTokens: tokens });
  }
  return tokens;
}

export async function getValidSpotifyTokens() {
  let tokens = await loadSpotifyTokens();
  if (!tokens) {
    if (globalThis.chrome?.storage?.local) {
      const local = await chrome.storage.local.get("spotifyTokens");
      tokens = local.spotifyTokens || null;
    }
  }
  if (!tokens?.accessToken) return null;
  if (tokens.expiresAt && tokens.expiresAt < Date.now() + 30_000) {
    tokens = await refreshTokens(tokens);
  }
  return tokens;
}

export async function fetchNowPlaying() {
  const tokens = await getValidSpotifyTokens();
  if (!tokens?.accessToken) return null;
  const res = await fetch(NOW_URL, {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });
  if (res.status === 204) return { isPlaying: false };
  if (!res.ok) return null;
  const json = await res.json();
  const track = json.item;
  if (!track) return { isPlaying: Boolean(json.is_playing) };
  return {
    isPlaying: Boolean(json.is_playing),
    trackName: track.name || "",
    artistName: (track.artists || []).map((a) => a.name).join(", "),
    albumArt: track.album?.images?.[2]?.url || track.album?.images?.[0]?.url || "",
  };
}

export async function publishNowPlaying() {
  const playing = await fetchNowPlaying();
  if (!playing?.isPlaying) {
    await clearNowPlaying();
    return playing;
  }
  await saveNowPlaying({
    trackName: playing.trackName,
    artistName: playing.artistName,
    albumArt: playing.albumArt,
    isPlaying: true,
  });
  return playing;
}
