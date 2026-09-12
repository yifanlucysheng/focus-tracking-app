const CHARACTERS = {
  cat: {
    src: "../assets/cat.png",
    alt: "Cat buddy",
  },
  sleepbunny: {
    src: "../assets/sleepbunny.png",
    alt: "Sleep bunny buddy",
  },
};

const preview = document.getElementById("character-preview");
const options = Array.from(document.querySelectorAll(".buddy-option"));

const STORAGE_KEY = "focusBuddy.selectedCharacter";

function applyCharacter(id) {
  const character = CHARACTERS[id];
  if (!character || !preview) return;

  preview.classList.add("is-switching");

  window.setTimeout(() => {
    preview.src = character.src;
    preview.alt = character.alt;
    preview.classList.remove("is-switching");
  }, 120);

  options.forEach((button) => {
    const selected = button.dataset.character === id;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-selected", selected ? "true" : "false");
  });

  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Ignore storage errors in private browsing contexts.
  }
}

options.forEach((button) => {
  button.addEventListener("click", () => {
    applyCharacter(button.dataset.character);
  });
});

let initial = "sleepbunny";
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && CHARACTERS[saved]) initial = saved;
} catch {
  // Keep default.
}

applyCharacter(initial);
