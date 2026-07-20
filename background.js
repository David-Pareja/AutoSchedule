/**
 * Auto Scheduler Pro - Background Worker
 */

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "add-selection-to-scheduler",
    title: "Parse Highlight with Auto Scheduler",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "add-selection-to-scheduler" && info.selectionText) {
    const text = info.selectionText;
    const url = tab.url; // Grab URL from the tab object
    
    const parsed = parseQuickSelectionText(text, url);

    chrome.storage.local.set({ highlightedEvent: parsed }, () => {
      chrome.action.openPopup();
    });
  }
});

function parseQuickSelectionText(text, url) {
  const base = new Date();
  base.setDate(base.getDate() + 1);

  const event = {
    title: text.length > 25 ? text.substring(0, 22) + "..." : text,
    date: base.toISOString().split('T')[0],
    time: "10:00",
    location: "Online Meeting",
    description: `Highlighted Selection Context:\n"${text}"\n\nSource: [Email Link](${url})`
  };

  const timeMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (timeMatch) {
    let hr = parseInt(timeMatch[1]);
    const min = timeMatch[2] ? timeMatch[2] : "00";
    const per = timeMatch[3] ? timeMatch[3].toLowerCase() : "";
    if (per === "pm" && hr < 12) hr += 12;
    if (per === "am" && hr === 12) hr = 0;
    event.time = `${hr < 10 ? '0' + hr : hr}:${min}`;
  }

  return event;
}