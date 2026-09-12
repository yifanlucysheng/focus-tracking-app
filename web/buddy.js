import { CHARACTERS, STORAGE_KEY, loadSelectedCharacterId } from "./characters.js";
import { mountSiteNav } from "./layout.js";
import { isCloudConfigured, updateUserDoc } from "./cloud.js";

const preview = document.getElementById("character-preview");
const bioName = document.getElementById("buddy-bio-name");
const bioBlurb = document.getElementById("buddy-bio-blurb");
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

  if (bioName) bioName.textContent = character.name;
  if (bioBlurb) bioBlurb.textContent = character.blurb;

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

  try {
    window.postMessage(
      {
        source: "focus-buddy-website",
        type: "SET_SELECTED_CHARACTER",
        characterId: id,
      },
      "*"
    );
  } catch {
    // Ignore if messaging is blocked.
  }

  if (isCloudConfigured()) {
    void updateUserDoc({ characterId: id }).catch(() => {});
  }
}

options.forEach((button) => {
  button.addEventListener("click", () => {
    applyCharacter(button.dataset.character);
  });
});

mountSiteNav("home");
applyCharacter(selectedCharacterId);
