// Popup script — task input, timer & character sections

const DEFAULT_SECONDS = 25 * 60;
const LOG_POLL_MS = 10_000;

let remainingSeconds = DEFAULT_SECONDS;
let countdownId = null;
let logPollId = null;

const timerDisplay = document.getElementById("timer-display");
const startBtn = document.getElementById("start-task-btn");
const characterImg = document.getElementById("character-img");
const summarySection = document.getElementById("summary-section");
const summaryText = document.getElementById("summary-text");

function getLinksForTask(taskText) {
  const text = taskText.toLowerCase();

  const keywordLinks = {
    chemistry: [
      "https://www.chemguide.co.uk/",
      "https://ptable.com/",
      "https://www.khanacademy.org/science/chemistry",
    ],
    essay: [
      "https://www.citationmachine.net/",
      "https://docs.google.com/document/create",
    ],
  };

  for (const keyword of Object.keys(keywordLinks)) {
    if (text.includes(keyword)) {
      return keywordLinks[keyword];
    }
  }

  return [
    "https://www.google.com/search?q=" + encodeURIComponent(taskText),
  ];
}

function openTaskTabs() {
  const taskText = document.getElementById("task-text")?.value?.trim() ?? "";
  if (!taskText) return;

  chrome.runtime.sendMessage({
    type: "OPEN_TASK_TABS",
    links: getLinksForTask(taskText),
  });
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function updateTimerDisplay() {
  timerDisplay.textContent = formatTime(remainingSeconds);
}

function getEntryStatus(entry) {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") {
    return entry.status ?? entry.state ?? entry.focus ?? null;
  }
  return null;
}

function setCharacterMood(status) {
  const isOnTask = status === "on-task";
  characterImg.classList.remove("on-task", "distracted");
  characterImg.classList.add(isOnTask ? "on-task" : "distracted");
  characterImg.setAttribute("aria-label", isOnTask ? "on-task" : "distracted");

  if (characterImg.tagName === "IMG") {
    characterImg.src = isOnTask ? "sleepbunny.png" : "angrybunny.png";
  }
}

function requestFocusLog(callback) {
  try {
    chrome.runtime.sendMessage({ type: "GET_LOG" }, (response) => {
      if (chrome.runtime.lastError) {
        callback(null);
        return;
      }
      const focusLog = Array.isArray(response)
        ? response
        : (response?.focusLog ?? null);
      callback(focusLog);
    });
  } catch {
    callback(null);
  }
}

function pollLatestFocusStatus() {
  requestFocusLog((focusLog) => {
    if (!Array.isArray(focusLog) || focusLog.length === 0) return;
    const latest = focusLog[focusLog.length - 1];
    const status = getEntryStatus(latest);
    if (status === "on-task" || status === "distracted") {
      setCharacterMood(status);
    }
  });
}

function showSummary() {
  requestFocusLog((focusLog) => {
    const log = Array.isArray(focusLog) ? focusLog : [];
    const onTaskCount = log.filter((entry) => getEntryStatus(entry) === "on-task").length;
    const percent = log.length === 0 ? 0 : Math.round((onTaskCount / log.length) * 100);

    summaryText.textContent = `You stayed on-task ${percent}% of the time.`;
    summarySection.hidden = false;
  });
}

function stopTimer() {
  if (countdownId !== null) {
    clearInterval(countdownId);
    countdownId = null;
  }
  if (logPollId !== null) {
    clearInterval(logPollId);
    logPollId = null;
  }
  startBtn.disabled = false;
}

function tick() {
  remainingSeconds -= 1;
  updateTimerDisplay();

  if (remainingSeconds <= 0) {
    remainingSeconds = 0;
    updateTimerDisplay();
    stopTimer();
    showSummary();
  }
}

function startTimer() {
  if (countdownId !== null) return;

  remainingSeconds = DEFAULT_SECONDS;
  updateTimerDisplay();
  summarySection.hidden = true;
  startBtn.disabled = true;

  openTaskTabs();
  pollLatestFocusStatus();
  countdownId = setInterval(tick, 1000);
  logPollId = setInterval(pollLatestFocusStatus, LOG_POLL_MS);
}

startBtn?.addEventListener("click", startTimer);
updateTimerDisplay();
