/**
 * chrome.storage.local adapter for @supabase/supabase-js AuthClient.
 * Required in MV3: service workers have no window.localStorage, and the
 * popup's localStorage is not shared with the background worker.
 */

/**
 * @returns {import('@supabase/supabase-js').SupportedStorage}
 */
export function createChromeStorageAdapter() {
  return {
    getItem: async (key) => {
      const result = await chrome.storage.local.get(key);
      const value = result[key];
      return typeof value === "string" ? value : null;
    },
    setItem: async (key, value) => {
      await chrome.storage.local.set({ [key]: value });
    },
    removeItem: async (key) => {
      await chrome.storage.local.remove(key);
    },
  };
}
