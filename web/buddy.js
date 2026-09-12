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
const SITES_KEY = "focusBuddy.allowedSites";
const TASK_KEY = "focusBuddy.task";

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

/* —— Dashboard: task, sites, timer —— */

const taskInput = document.getElementById("task-input");
const siteInput = document.getElementById("site-input");
const addSiteBtn = document.getElementById("add-site-btn");
const siteList = document.getElementById("site-list");
const hoursInput = document.getElementById("hours-input");
const minutesInput = document.getElementById("minutes-input");
const timerDisplay = document.getElementById("timer-display");
const startBtn = document.getElementById("start-timer-btn");
const pauseBtn = document.getElementById("pause-timer-btn");
const endBtn = document.getElementById("end-timer-btn");
const timerStatus = document.getElementById("timer-status");

let allowedSites = [];
let remainingSeconds = 25 * 60;
let countdownId = null;
let isPaused = false;

function loadTask() {
  try {
    const saved = localStorage.getItem(TASK_KEY);
    if (saved && taskInput) taskInput.value = saved;
  } catch {
    // Ignore.
  }
}

function saveTask() {
  try {
    localStorage.setItem(TASK_KEY, taskInput?.value?.trim() ?? "");
  } catch {
    // Ignore.
  }
}

function loadSites() {
  try {
    const raw = localStorage.getItem(SITES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    allowedSites = Array.isArray(parsed) ? parsed : [];
  } catch {
    allowedSites = [];
  }
  renderSites();
}

function saveSites() {
  try {
    localStorage.setItem(SITES_KEY, JSON.stringify(allowedSites));
  } catch {
    // Ignore.
  }
}

function normalizeSite(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withProtocol);
    if (!url.hostname) return null;
    return url.href.replace(/\/$/, "");
  } catch {
    return null;
  }
}

function renderSites() {
  if (!siteList) return;
  siteList.innerHTML = "";

  allowedSites.forEach((site, index) => {
    const li = document.createElement("li");
    li.className = "site-chip";

    const label = document.createElement("span");
    label.textContent = site;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${site}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      allowedSites.splice(index, 1);
      saveSites();
      renderSites();
    });

    li.append(label, remove);
    siteList.appendChild(li);
  });
}

function addSite() {
  const site = normalizeSite(siteInput?.value ?? "");
  if (!site) {
    if (timerStatus) timerStatus.textContent = "Enter a valid website URL.";
    return;
  }

  if (allowedSites.includes(site)) {
    if (timerStatus) timerStatus.textContent = "That site is already on your list.";
    return;
  }

  allowedSites.push(site);
  saveSites();
  renderSites();
  if (siteInput) siteInput.value = "";
  if (timerStatus) timerStatus.textContent = "";
}

function clampNumber(value, min, max) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function readDurationSeconds() {
  const hours = clampNumber(hoursInput?.value ?? 0, 0, 12);
  const minutes = clampNumber(minutesInput?.value ?? 0, 0, 59);
  if (hoursInput) hoursInput.value = String(hours);
  if (minutesInput) minutesInput.value = String(minutes);
  const total = hours * 3600 + minutes * 60;
  return total > 0 ? total : 60;
}

function formatTime(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function updateTimerDisplay() {
  if (timerDisplay) timerDisplay.textContent = formatTime(remainingSeconds);
}

function setTimerControls({ running, paused }) {
  if (startBtn) startBtn.disabled = running || paused;
  if (pauseBtn) {
    pauseBtn.disabled = !running && !paused;
    pauseBtn.textContent = paused ? "Resume" : "Pause";
  }
  if (endBtn) endBtn.disabled = !running && !paused;

  const durationDisabled = running || paused;
  if (hoursInput) hoursInput.disabled = durationDisabled;
  if (minutesInput) minutesInput.disabled = durationDisabled;
}

function clearCountdown() {
  if (countdownId !== null) {
    clearInterval(countdownId);
    countdownId = null;
  }
}

function tick() {
  remainingSeconds -= 1;
  updateTimerDisplay();

  if (remainingSeconds <= 0) {
    remainingSeconds = 0;
    updateTimerDisplay();
    clearCountdown();
    isPaused = false;
    setTimerControls({ running: false, paused: false });
    const task = taskInput?.value?.trim();
    if (timerStatus) {
      timerStatus.textContent = task
        ? `Session complete — nice work on “${task}”.`
        : "Session complete — nice work!";
    }
  }
}

function startTimer() {
  if (countdownId !== null || isPaused) return;

  saveTask();
  remainingSeconds = readDurationSeconds();
  updateTimerDisplay();
  isPaused = false;
  setTimerControls({ running: true, paused: false });

  const task = taskInput?.value?.trim();
  if (timerStatus) {
    timerStatus.textContent = task ? `Focusing on “${task}”…` : "Focus session running…";
  }

  countdownId = setInterval(tick, 1000);
}

function pauseOrResumeTimer() {
  if (!isPaused && countdownId === null) return;

  if (isPaused) {
    isPaused = false;
    setTimerControls({ running: true, paused: false });
    if (timerStatus) timerStatus.textContent = "Session resumed.";
    countdownId = setInterval(tick, 1000);
    return;
  }

  isPaused = true;
  clearCountdown();
  setTimerControls({ running: false, paused: true });
  if (timerStatus) timerStatus.textContent = "Paused.";
}

function endTimer() {
  clearCountdown();
  isPaused = false;
  remainingSeconds = readDurationSeconds();
  updateTimerDisplay();
  setTimerControls({ running: false, paused: false });
  if (timerStatus) timerStatus.textContent = "Session ended.";
}

function syncDisplayFromInputs() {
  if (countdownId !== null || isPaused) return;
  remainingSeconds = readDurationSeconds();
  updateTimerDisplay();
}

taskInput?.addEventListener("change", saveTask);
taskInput?.addEventListener("blur", saveTask);
addSiteBtn?.addEventListener("click", addSite);
siteInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addSite();
  }
});
hoursInput?.addEventListener("input", syncDisplayFromInputs);
minutesInput?.addEventListener("input", syncDisplayFromInputs);
startBtn?.addEventListener("click", startTimer);
pauseBtn?.addEventListener("click", pauseOrResumeTimer);
endBtn?.addEventListener("click", endTimer);

loadTask();
loadSites();
remainingSeconds = readDurationSeconds();
updateTimerDisplay();
setTimerControls({ running: false, paused: false });
