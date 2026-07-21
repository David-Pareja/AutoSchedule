chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "add-selection-to-scheduler",
    title: "Parse Text to SmartSchedule",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "add-selection-to-scheduler" && info.selectionText) {
    const text = info.selectionText;
    const url = tab.url;
    const parsed = parseQuickSelectionText(text, url);

    chrome.storage.local.set({ highlightedEvent: parsed }, () => {
      chrome.action.openPopup();
    });
  }
});

function formatLocalDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseQuickSelectionText(text, url) {
  const base = new Date();
  base.setDate(base.getDate() + 1);

  const event = {
    title: text.length > 25 ? text.substring(0, 22) + "..." : text,
    date: formatLocalDate(base),
    time: "10:00",
    location: "Online Meeting",
    description: `Highlighted selection: ${text}\n\nSource: ${url}`
  };

  const timeMatch = text.match(/(?:\bat\b|@)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i)
    || text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (timeMatch) {
    let hr = parseInt(timeMatch[1], 10);
    const min = timeMatch[2] || "00";
    const per = timeMatch[3] ? timeMatch[3].toLowerCase() : "";
    if (per === "pm" && hr < 12) hr += 12;
    if (per === "am" && hr === 12) hr = 0;
    if (hr <= 23) event.time = `${hr < 10 ? '0' + hr : hr}:${min}`;
  }

  return event;
}