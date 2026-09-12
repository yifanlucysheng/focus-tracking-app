// Popup script (no logic yet)

// --- task input ---
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

document.getElementById("start-task-btn").addEventListener("click", () => {
  const taskText = document.getElementById("task-text").value;
  const links = getLinksForTask(taskText);
  chrome.runtime.sendMessage({
    type: "OPEN_TASK_TABS",
    links,
  });
});
