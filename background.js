importScripts('dateParser.js');

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "add-selection-to-scheduler",
    title: "Parse Text to SmartSchedule",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "add-selection-to-scheduler" && info.selectionText) {
    // Only the highlighted selection is parsed here — never the rest of the
    // page — so the popup reflects exactly what the user highlighted.
    const parsed = parseQuickSelectionText(info.selectionText, tab.url);
    chrome.storage.local.set({ highlightedEvent: parsed }, () => {
      chrome.action.openPopup();
    });
  }
});

function parseQuickSelectionText(text, url) {
  const baseDate = new Date();

  const event = {
    title: text.length > 25 ? text.substring(0, 22) + "..." : text,
    date: "", time: "", location: ""
  };

  // Leave date/time blank rather than guessing when nothing was confidently
  // parsed, so the user notices and fills it in instead of syncing a wrong guess.
  const dateVerbose = DateParser.parseDateFromTextVerbose(text, baseDate);
  event.date = dateVerbose.date ? DateParser.formatLocalDate(dateVerbose.date) : "";

  const timeVerbose = DateParser.parseTimeInfoVerbose(text);
  event.time = timeVerbose.time || "";
  if (timeVerbose.range) event.durationMinutes = timeVerbose.range.durationMinutes;

  const locationInfo = DateParser.parseLocationFromText(text);
  event.location = locationInfo.location || "";

  const descParts = [];
  if (locationInfo.meetingLink) descParts.push(`Join: ${locationInfo.meetingLink}`);
  descParts.push(`Highlighted selection: ${text}`);
  descParts.push(`Source: ${url}`);
  event.description = descParts.join('\n\n');

  event.debug = {
    body: { source: 'highlighted-selection', matchedNodes: 1, rawChars: text.length, strippedChars: 0 },
    emailDate: { source: 'not applicable — highlight uses the current time as its base date', attr: null, raw: null },
    date: dateVerbose,
    time: timeVerbose,
    location: locationInfo
  };

  return event;
}
