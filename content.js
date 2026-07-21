/* Content script: parses email bodies and watches for SPA navigation */

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
                'august', 'september', 'october', 'november', 'december'];

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "scan_email_content") {
    sendResponse({ parsedData: scanCurrentEmail() });
  }
  return true;
});

function scanCurrentEmail() {
  const emailBody = grabActiveEmailBody();
  const emailDate = grabActiveEmailDate();
  return parseTextWithBaseDate(emailBody, emailDate, location.href);
}

function grabActiveEmailDate() {
  let matchedDateStr = "";
  const gmailTimeTags = document.querySelectorAll('.g3, .xo, span[role="gridcell"], .gE.iv');
  if (gmailTimeTags.length > 0) matchedDateStr = gmailTimeTags[gmailTimeTags.length - 1].innerText || "";

  if (!matchedDateStr) {
    const outlookTimeTags = document.querySelectorAll('[data-focusable="true"] span, .allowTextSelection span, .O7Pr6');
    for (const tag of outlookTimeTags) {
      const text = tag.innerText || "";
      if (text.includes("AM") || text.includes("PM") || (text.includes(",") && text.match(/\d/))) {
        matchedDateStr = text;
        break;
      }
    }
  }
  const parsed = matchedDateStr ? new Date(Date.parse(matchedDateStr)) : new Date();
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

function grabActiveEmailBody() {
  let text = "";
  const gContainers = document.querySelectorAll('.a3s, .ii.gt, .gm-email-body');
  if (gContainers.length > 0) text = gContainers[gContainers.length - 1].innerText;

  if (!text) {
    const oContainers = document.querySelectorAll('[role="document"], .ReadMsgBody, .allowTextSelection');
    if (oContainers.length > 0) text = oContainers[0].innerText;
  }
  return text || document.body.innerText || "";
}

/* ---------- Parsing helpers ---------- */

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

function matchWeekdayToken(word) {
  word = word.toLowerCase().replace(/[^a-z]/g, '');
  if (word.length < 4) return null;
  let best = null, bestDist = Infinity;
  for (const day of DAYS) {
    const threshold = day.length <= 6 ? 1 : 2;
    const dist = levenshtein(word, day);
    if (dist <= threshold && dist < bestDist) { bestDist = dist; best = day; }
  }
  return best;
}

function isNextWord(word) {
  word = (word || '').toLowerCase().replace(/[^a-z]/g, '');
  return word === 'next' || (word.length >= 3 && levenshtein(word, 'next') <= 1);
}

function parseDateFromText(text, baseDate) {
  const lower = text.toLowerCase();

  if (/\btoday\b/.test(lower)) return new Date(baseDate);
  if (/\btomorrow\b/.test(lower)) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + 1);
    return d;
  }

  // Numeric date: 7/25, 7-25-2026
  const numericDate = lower.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (numericDate) {
    const month = parseInt(numericDate[1], 10) - 1;
    const day = parseInt(numericDate[2], 10);
    let year = numericDate[3] ? parseInt(numericDate[3], 10) : baseDate.getFullYear();
    if (year < 100) year += 2000;
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime()) && month >= 0 && month < 12) return d;
  }

  // "July 25th"
  const monthMatch = lower.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (monthMatch) {
    const month = MONTHS.indexOf(monthMatch[1]);
    const day = parseInt(monthMatch[2], 10);
    const d = new Date(baseDate.getFullYear(), month, day);
    if (d < baseDate) d.setFullYear(d.getFullYear() + 1);
    return d;
  }

  // Weekday, with optional (typo-tolerant) "next"
  const words = lower.split(/[^a-z]+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const day = matchWeekdayToken(words[i]);
    if (!day) continue;
    const usedNext = i > 0 && isNextWord(words[i - 1]);
    let dist = DAYS.indexOf(day) - baseDate.getDay();
    if (dist <= 0) dist += 7;
    if (usedNext) dist += 7;
    const d = new Date(baseDate);
    d.setDate(baseDate.getDate() + dist);
    return d;
  }

  return null;
}

function parseTimeFromText(text) {
  const lower = text.toLowerCase();
  if (/\bnoon\b/.test(lower)) return "12:00";
  if (/\bmidnight\b/.test(lower)) return "00:00";

  const patterns = [
    /(?:\bat\b|@)\s*(?<hr>\d{1,2})(?::(?<min>\d{2}))?\s*(?<ampm>am|pm)?/i,
    /\b(?<hr>\d{1,2}):(?<min>\d{2})\s*(?<ampm>am|pm)?\b/i,
    /\b(?<hr>\d{1,2})\s*(?<ampm>am|pm)\b/i
  ];

  for (const re of patterns) {
    const m = lower.match(re);
    if (m && m.groups && m.groups.hr) {
      let hr = parseInt(m.groups.hr, 10);
      if (hr > 23) continue;
      const min = m.groups.min || "00";
      const ampm = m.groups.ampm;
      if (ampm === "pm" && hr < 12) hr += 12;
      if (ampm === "am" && hr === 12) hr = 0;
      if (hr > 23) continue;
      return `${hr < 10 ? '0' + hr : hr}:${min}`;
    }
  }
  return null;
}

function formatLocalDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseTextWithBaseDate(text, baseDate, url) {
  const result = {
    title: document.title ? document.title.replace(/ - Outlook| - Gmail/ig, "").trim() : "Scheduled Event",
    date: "", time: "10:00", location: "Online", description: ""
  };

  let calculatedDate = parseDateFromText(text, baseDate);
  if (!calculatedDate) {
    calculatedDate = new Date(baseDate);
    calculatedDate.setDate(baseDate.getDate() + 1);
  }
  result.date = formatLocalDate(calculatedDate);

  const parsedTime = parseTimeFromText(text);
  if (parsedTime) result.time = parsedTime;

  const snippet = text.substring(0, 100).replace(/\n/g, ' ').trim();
  result.description = `Parsed content: ${snippet}...\n\nSource: ${url}`;

  return result;
}

/* ---------- SPA URL-change watcher (event-driven, lightweight) ---------- */

(function watchUrlChanges() {
  let lastUrl = location.href;
  let debounceTimer = null;

  function handleUrlChange() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    clearTimeout(debounceTimer);
    // Wait for the SPA to finish rendering the new email before scanning
    debounceTimer = setTimeout(() => {
      const parsed = scanCurrentEmail();
      chrome.storage.local.set({ lastParsed: parsed, lastParsedUrl: location.href });
    }, 600);
  }

  const originalPushState = history.pushState;
  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    handleUrlChange();
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    handleUrlChange();
  };

  window.addEventListener('popstate', handleUrlChange);
  window.addEventListener('hashchange', handleUrlChange);
})();