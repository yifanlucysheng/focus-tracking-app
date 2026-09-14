import { mountSectionDivider, mountSiteNav } from "./layout.js";
import { bootCloudSync } from "./session-sync.js";
import {
  isCloudConfigured,
  listIncomingRequests,
  listenAuth,
  loadUserDoc,
  savePrivacy,
  signInWithEmail,
  signOutUser,
  signUpWithEmail,
  updateUserDoc,
  clearSpotifyTokens,
  loadSpotifyTokens,
} from "./cloud.js";
import { connectSpotify, isSpotifyConfigured, publishNowPlaying } from "./spotify.js";
import { initFoldersPanel } from "./foldersPanel.js";
import { initSiteLists } from "./siteLists.js";

mountSiteNav("settings");
mountSectionDivider("Settings");

const banner = document.getElementById("settings-banner");
const signedOut = document.getElementById("signed-out-panel");
const signedIn = document.getElementById("signed-in-panel");
const signedInMore = document.getElementById("signed-in-more");
const usernameLabel = document.getElementById("settings-username");
const statusInput = document.getElementById("status-input");
const shareStats = document.getElementById("share-stats-toggle");
const shareListening = document.getElementById("share-listening-toggle");
const spotifyStatus = document.getElementById("spotify-status");
const spotifyRedirectHint = document.getElementById("spotify-redirect-hint");
const geminiStatus = document.getElementById("gemini-status");
const geminiKeyInput = document.getElementById("gemini-key-input");

function setBanner(text) {
  if (banner) banner.textContent = text || "";
}

function setSignedIn(on) {
  if (signedOut) signedOut.hidden = Boolean(on);
  if (signedIn) signedIn.hidden = !on;
  if (signedInMore) signedInMore.hidden = !on;
}

async function refreshGeminiLabel() {
  if (!geminiStatus) return;
  try {
    if (!globalThis.chrome?.storage?.local) {
      geminiStatus.textContent =
        "Open Settings from the Focus Buddy popup so the Gemini key can be saved on this device.";
      return;
    }
    const stored = await chrome.storage.local.get("geminiApiKey");
    const hasKey = Boolean(String(stored.geminiApiKey || "").trim());
    geminiStatus.textContent = hasKey
      ? "Gemini key saved on this device. Unknown sites can be classified during lock-in."
      : "Optional. Lock-in still works from folders, allow/block lists, and task words if this is empty.";
  } catch {
    geminiStatus.textContent = "Could not read the Gemini key store.";
  }
}

async function refreshSpotifyLabel() {
  const tokens = await loadSpotifyTokens().catch(() => null);
  if (spotifyStatus) {
    spotifyStatus.textContent = tokens?.accessToken ? "Spotify connected" : "Not connected";
  }
  if (spotifyRedirectHint) {
    if (globalThis.chrome?.identity?.getRedirectURL) {
      spotifyRedirectHint.textContent = `Redirect URI to add in Spotify Dashboard: ${chrome.identity.getRedirectURL()}`;
    } else {
      spotifyRedirectHint.textContent =
        "Open this Settings page from the Focus Buddy popup (Open dashboard). Connect Spotify does not work in a normal browser tab.";
    }
  }
}

async function renderAccount() {
  const user = await loadUserDoc();
  if (!user) {
    setSignedIn(false);
    return;
  }
  setSignedIn(true);
  if (usernameLabel) usernameLabel.textContent = user.username || user.displayName || "You";
  if (statusInput) statusInput.value = user.customStatus || "";
  if (shareStats) shareStats.checked = Boolean(user.shareStats);
  if (shareListening) shareListening.checked = Boolean(user.shareListening);
  await refreshSpotifyLabel();
  await refreshGeminiLabel();

  const requests = await listIncomingRequests().catch(() => []);
  if (requests.length) {
    setBanner(
      `Friend request from ${requests.map((r) => r.fromUsername).join(", ")}. Accept them on the Friends page.`
    );
  }
}

document.getElementById("signup-btn")?.addEventListener("click", async () => {
  try {
    await signUpWithEmail({
      username: document.getElementById("signup-username")?.value,
      email: document.getElementById("signup-email")?.value,
      password: document.getElementById("signup-password")?.value,
    });
    setBanner("Account created.");
    await renderAccount();
  } catch (error) {
    const raw = error.message || "Could not create account.";
    setBanner(
      /permission|insufficient/i.test(raw)
        ? "Firebase Auth worked or almost did, but Firestore rules are blocking the profile write. In Firebase Console open Firestore → Rules, paste firestore.rules from this project, and click Publish."
        : raw
    );
  }
});

document.getElementById("signin-btn")?.addEventListener("click", async () => {
  try {
    await signInWithEmail(
      document.getElementById("signin-email")?.value,
      document.getElementById("signin-password")?.value
    );
    setBanner("");
  } catch (error) {
    setBanner(error.message || "Could not sign in.");
  }
});

document.getElementById("signout-btn")?.addEventListener("click", () => signOutUser());
document.getElementById("save-status-btn")?.addEventListener("click", async () => {
  try {
    await updateUserDoc({ customStatus: statusInput?.value?.trim() || "" });
    setBanner("Status saved.");
  } catch (error) {
    setBanner(error.message);
  }
});

async function persistPrivacy() {
  try {
    await savePrivacy({
      shareStats: Boolean(shareStats?.checked),
      shareListening: Boolean(shareListening?.checked),
    });
    setBanner("Privacy updated.");
  } catch (error) {
    setBanner(error.message);
  }
}

shareStats?.addEventListener("change", persistPrivacy);
shareListening?.addEventListener("change", persistPrivacy);

document.getElementById("save-gemini-btn")?.addEventListener("click", async () => {
  const key = String(geminiKeyInput?.value || "").trim();
  if (!key) {
    setBanner("Paste a Gemini API key first, or click Remove key.");
    return;
  }
  try {
    if (!globalThis.chrome?.storage?.local) {
      setBanner("Open this page from the Focus Buddy popup (Open dashboard).");
      return;
    }
    await chrome.storage.local.set({ geminiApiKey: key });
    if (geminiKeyInput) geminiKeyInput.value = "";
    await refreshGeminiLabel();
    setBanner("Gemini key saved on this Chrome profile.");
  } catch (error) {
    setBanner(error.message || "Could not save Gemini key.");
  }
});

document.getElementById("clear-gemini-btn")?.addEventListener("click", async () => {
  try {
    if (globalThis.chrome?.storage?.local) {
      await chrome.storage.local.remove("geminiApiKey");
    }
    if (geminiKeyInput) geminiKeyInput.value = "";
    await refreshGeminiLabel();
    setBanner("Gemini key removed. Lock-in still uses lists and task words.");
  } catch (error) {
    setBanner(error.message || "Could not remove Gemini key.");
  }
});

document.getElementById("spotify-connect-btn")?.addEventListener("click", async () => {
  try {
    if (!isSpotifyConfigured()) {
      setBanner("Add your Spotify client ID to web/firebase-config.js");
      return;
    }
    await connectSpotify();
    await publishNowPlaying();
    await refreshSpotifyLabel();
    setBanner("Spotify connected. Only friends can see it if listening sharing is on.");
  } catch (error) {
    setBanner(error.message);
  }
});

document.getElementById("spotify-disconnect-btn")?.addEventListener("click", async () => {
  await clearSpotifyTokens();
  try {
    await chrome.storage.local.remove("spotifyTokens");
  } catch {
    // Not running inside the extension.
  }
  await refreshSpotifyLabel();
  setBanner("Spotify disconnected.");
});

const bootNote = await bootCloudSync();
initFoldersPanel();
initSiteLists();
await refreshSpotifyLabel();
await refreshGeminiLabel();
if (!isCloudConfigured()) {
  setBanner(bootNote);
} else {
  await listenAuth(async (user) => {
    if (!user) {
      setSignedIn(false);
      return;
    }
    await renderAccount();
  });
}
