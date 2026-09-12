export const CHARACTERS = {
  cat: {
    src: "../cat.png",
    alt: "Cat buddy",
    name: "Cat Buddy",
    blurb:
      "Your ordinary house cat. Cat Buddy treats every assignment like a sunbeam: sit still, stay close, and will be very VERY upset if you wander off to a distracting tab.",
  },
  sleepbunny: {
    src: "../moon1.png",
    alt: "Moon buddy",
    name: "Moon Buddy",
    blurb:
      "Spun from moondust on another planet's moon, then drifted here on a sleepy comet. Moon Buddy dozes beside your work so your focus has somewhere quiet and glowing to land.",
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
