import { isCloudConfigured, listenAuth, syncPendingSessions } from "./cloud.js";

export async function bootCloudSync() {
  if (!isCloudConfigured()) return "Add Firebase keys in web/firebase-config.js to sync accounts.";
  try {
    await listenAuth(async (user) => {
      if (!user || !globalThis.chrome?.storage?.local) return;
      const stored = await chrome.storage.local.get("pendingSessions");
      const leftover = await syncPendingSessions(stored.pendingSessions || []);
      await chrome.storage.local.set({ pendingSessions: leftover });
    });
    return "";
  } catch (error) {
    return error.message || "Could not connect to Firebase.";
  }
}

export function formatSessionClock(totalSeconds) {
  const safe = Math.max(0, Number(totalSeconds) || 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
