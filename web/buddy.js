import { CHARACTERS, STORAGE_KEY, loadSelectedCharacterId } from "./characters.js";
import { mountSiteNav } from "./layout.js";

const preview = document.getElementById("character-preview");
const options = Array.from(document.querySelectorAll(".buddy-option"));

let selectedCharacterId = loadSelectedCharacterId();

function applyCharacter(id) {
  const character = CHARACTERS[id];
  if (!character || !preview) return;

  selectedCharacterId = id;
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

mountSiteNav("home");
applyCharacter(selectedCharacterId);
