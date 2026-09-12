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

function setBanner(text) {
  if (banner) banner.textContent = text || "";
}

function setSignedIn(on) {
  if (signedOut) signedOut.hidden = Boolean(on);
  if (signedIn) signedIn.hidden = !on;
  if (signedInMore) signedInMore.hidden = !on;
}

async function refreshSpotifyLabel() {
  const tokens = await loadSpotifyTokens().catch(() => null);
  if (spotifyStatus) {
    spotifyStatus.textContent = tokens?.accessToken ? "Spotify connected" : "Not connected";
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
