import {
  CHARACTERS,
  STORAGE_KEY,
  characterImageUrl,
  loadSelectedCharacterIdAsync,
} from "./characters.js";
import { mountSiteNav } from "./layout.js";
import { isCloudConfigured, updateUserDoc } from "./cloud.js";

const preview = document.getElementById("character-preview");
const bioName = document.getElementById("buddy-bio-name");
const bioBlurb = document.getElementById("buddy-bio-blurb");
const options = Array.from(document.querySelectorAll(".buddy-option"));

let selectedCharacterId = "sleepbunny";

function pushCharacterToExtension(id) {
  try {
    if (globalThis.chrome?.runtime?.sendMessage) {
      chrome.runtime.sendMessage(
        { type: "SET_SELECTED_CHARACTER", characterId: id },
        () => {
          void chrome.runtime.lastError;
        }
      );
      return;
    }
  } catch {
    // Fall through to page-bridge postMessage.
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
}

function applyCharacter(id) {
  const character = CHARACTERS[id];
  if (!character || !preview) return;

  selectedCharacterId = id;
  preview.classList.add("is-switching");

  window.setTimeout(() => {
    preview.src = characterImageUrl(id);
    preview.alt = character.alt;
    preview.classList.remove("is-switching");
  }, 120);

  if (bioName) bioName.textContent = character.name;
  if (bioBlurb) bioBlurb.textContent = character.blurb;

  options.forEach((button) => {
    const selected = button.dataset.character === id;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-selected", selected ? "true" : "false");
    const thumb = button.querySelector("img");
    if (thumb) thumb.src = characterImageUrl(button.dataset.character);
  });

  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Ignore storage errors in private browsing contexts.
  }

  pushCharacterToExtension(id);

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
selectedCharacterId = await loadSelectedCharacterIdAsync();
applyCharacter(selectedCharacterId);
