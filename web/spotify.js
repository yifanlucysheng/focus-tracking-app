/** Spotify integration is optional and not wired to Supabase yet. */
export function isSpotifyConfigured() {
  return false;
}

export async function connectSpotify() {
  throw new Error("Spotify is not configured on this build.");
}

export async function publishNowPlaying() {
  return null;
}
