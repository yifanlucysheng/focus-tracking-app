export const CHARACTERS = {
  cat: {
    src: "../assets/cat.png",
    alt: "Cat buddy",
  },
  sleepbunny: {
    src: "../assets/sleepbunny.png",
    alt: "Sleep bunny buddy",
  },
};

export const STORAGE_KEY = "focusBuddy.selectedCharacter";

export function loadSelectedCharacterId() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && CHARACTERS[saved]) return saved;
  } catch {
    // Keep default.
  }
  return "sleepbunny";
}
