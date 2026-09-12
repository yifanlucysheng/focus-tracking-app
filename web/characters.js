export const CHARACTERS = {
  cat: {
    src: "/cat.png",
    file: "cat.png",
    alt: "Cat buddy",
    name: "Cat Buddy",
    blurb:
      "Your ordinary house cat. Cat Buddy treats every assignment like a sunbeam: sit still, stay close, and will be very VERY upset if you wander off to a distracting tab.",
  },
  sleepbunny: {
    src: "/moon1.png",
    file: "moon1.png",
    alt: "Moon buddy",
    name: "Moon Buddy",
    blurb:
      "Spun from moondust on another planet's moon, then drifted here on a sleepy comet. Moon Buddy dozes beside your work so your focus has somewhere quiet and glowing to land.",
  },
};

export const STORAGE_KEY = "focusBuddy.selectedCharacter";

/** Image URL that works on the Vite site and chrome-extension dashboard pages. */
export function characterImageUrl(id) {
  const character = CHARACTERS[id] || CHARACTERS.sleepbunny;
  try {
    if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
      return chrome.runtime.getURL(character.file);
    }
  } catch {
    // Not running as an extension page.
  }
  return character.src;
}

export function loadSelectedCharacterId() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && CHARACTERS[saved]) return saved;
  } catch {
    // Keep default.
  }
  return "sleepbunny";
}

export async function loadSelectedCharacterIdAsync() {
  try {
    if (globalThis.chrome?.storage?.local?.get) {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const id = result[STORAGE_KEY];
      if (id && CHARACTERS[id]) return id;
    }
  } catch {
    // Fall through to localStorage.
  }
  return loadSelectedCharacterId();
}
