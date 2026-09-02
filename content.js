/* Content script: parses email bodies and watches for SPA navigation */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "scan_email_content") {
    sendResponse({ parsedData: scanCurrentEmail() });
  }
  return true;
});

function scanCurrentEmail() {
  const container = locateBodyContainer();
  const body = grabActiveEmailBody(container);
  const emailDate = grabActiveEmailDate(container);
  const smartCardText = findSmartEventCardText(container);
  // Feed the smart-card text in as a synthetic "When:" line ahead of the real
  // body — this reuses the existing label-matching logic as-is and naturally
  // wins over anything found later in the body, without touching the
  // description/location, which still reflect the actual message text.
  const dateTimeText = smartCardText ? `When: ${smartCardText}\n${body.text}` : body.text;
  return parseTextWithBaseDate(body.text, dateTimeText, emailDate.date, location.href, body.debug, emailDate.debug, smartCardText);
}

function isVisible(el) {
  return !!(el && el.offsetParent !== null && (el.innerText || '').trim());
}

/* Prefer an absolute-timestamp attribute (Gmail/Outlook both expose the full
   date in a title/aria-label tooltip) over the visible text, which is often a
   shorthand ("3:00 PM", "Sep 1") or a relative string that Date.parse guesses
   at unreliably. */
function absoluteDateFromNode(node) {
  if (node.getAttribute('title')) return { value: node.getAttribute('title'), attr: 'title' };
  if (node.getAttribute('aria-label')) return { value: node.getAttribute('aria-label'), attr: 'aria-label' };
  return { value: node.innerText || '', attr: 'innerText' };
}

// A calendar invite ("invite.ics") that was sent earlier in a thread often
// gets re-rendered inline, as its own mini message header (sender, star,
// reply button, and all) inside the body of whatever message is currently
// open. That embedded card carries its own .g3 date span for the *invite's*
// original send time, which is not the timestamp of the email actually on
// screen — it should be preferred against, but only when something else is
// available (never let excluding it leave zero candidates and fall to "now").
function isInsideEmbeddedInviteCard(node) {
  return !!node.closest('.gE.iv.gt');
}

const ABSOLUTE_DATE_LOOK_RE = new RegExp(
  '\\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s*\\d{4}\\b'
  + '|\\b\\d{1,2}[\\/\\-]\\d{1,2}[\\/\\-]\\d{2,4}\\b',
  'i'
);

function looksLikeAbsoluteDate(str) {
  return !!str && ABSOLUTE_DATE_LOOK_RE.test(str);
}

// Locates the currently-open message's body once, so both the body text and
// the date lookup search the same region instead of re-querying separately
// (and possibly disagreeing on which message is "active").
function locateBodyContainer() {
  const gContainers = Array.from(document.querySelectorAll('.a3s, .ii.gt, .gm-email-body')).filter(isVisible);
  if (gContainers.length > 0) return { node: gContainers[gContainers.length - 1], platform: 'gmail', matchedNodes: gContainers.length };

  // New Outlook (outlook.office.com / outlook.live.com "Monarch" UI) marks the
  // reading-pane body with a stable aria-label regardless of its ever-rotating
  // Fluent UI hashed class names — prefer it over the older/broader selectors.
  const newOutlookContainers = Array.from(document.querySelectorAll('[aria-label="Message body"][role="document"]')).filter(isVisible);
  if (newOutlookContainers.length > 0) return { node: newOutlookContainers[newOutlookContainers.length - 1], platform: 'outlook', matchedNodes: newOutlookContainers.length };

  const oContainers = Array.from(document.querySelectorAll('[role="document"], .ReadMsgBody, .allowTextSelection')).filter(isVisible);
  if (oContainers.length > 0) return { node: oContainers[0], platform: 'outlook', matchedNodes: oContainers.length };

  return null;
}

// Last-resort date lookup: rather than give up and anchor relative words
// ("tomorrow", "next week") to the live device clock, scan a bounded region
// around the message (a few levels up from its body, not the whole page —
// avoids picking up an unrelated date from Gmail's sidebar mini-calendar)
// for any element whose title/aria-label looks like an absolute date.
function findFallbackDateNode(bodyContainer) {
  if (!bodyContainer) return null;
  let scope = bodyContainer;
  for (let i = 0; i < 6 && scope.parentElement; i++) scope = scope.parentElement;

  const nodes = Array.from(scope.querySelectorAll('[title], [aria-label]')).filter(isVisible);
  for (let i = nodes.length - 1; i >= 0; i--) {
    const { value, attr } = absoluteDateFromNode(nodes[i]);
    if (looksLikeAbsoluteDate(value)) return { value, attr };
  }
  return null;
}

// Gmail sometimes renders its own ML-extracted "smart" event card below a
// matching message (visible as a small date/time + title card, often with
// Yes/No/Maybe RSVP buttons). Its data-card-id is a semantic, human-readable
// identifier ("...extractedsmartmailevent") rather than one of the short
// hashed class names around it, so it's used as the stable anchor. Google's
// own extraction is about as authoritative a date/time signal as exists, so
// when present it's preferred over re-deriving the same thing from prose.
function findSmartEventCardText(bodyContainer) {
  if (!bodyContainer) return null;
  let scope = bodyContainer.node;
  for (let i = 0; i < 6 && scope.parentElement; i++) scope = scope.parentElement;

  const card = Array.from(scope.querySelectorAll('[data-card-id*="extractedsmartmailevent"]')).filter(isVisible)[0];
  if (!card) return null;

  const specific = card.querySelector('.HZejI');
  const raw = specific ? specific.innerText : (card.innerText || '').split('\n')[0];
  const text = (raw || '').trim();
  return text || null;
}

function grabActiveEmailDate(container) {
  let matchedDateStr = "";
  let debugInfo = { source: 'none-fallback-now', attr: null, raw: null };

  const allGmailTags = Array.from(document.querySelectorAll('.g3, .xo, span[role="gridcell"], .gE.iv')).filter(isVisible);
  const preferredGmailTags = allGmailTags.filter(node => !isInsideEmbeddedInviteCard(node));
  const gmailTimeTags = preferredGmailTags.length ? preferredGmailTags : allGmailTags;
  if (gmailTimeTags.length > 0) {
    const { value, attr } = absoluteDateFromNode(gmailTimeTags[gmailTimeTags.length - 1]);
    if (value) {
      matchedDateStr = value;
      debugInfo = { source: preferredGmailTags.length ? 'gmail-date-node' : 'gmail-date-node-invite-card-fallback', attr, raw: value };
    }
  }

  if (!matchedDateStr) {
    // New Outlook's reading pane exposes the message's sent/received time via
    // this stable data-testid, structurally separate from the body container
    // above — so it's only ever used as the relative-date base, never scanned
    // as part of the message text itself.
    const newOutlookDateTags = Array.from(document.querySelectorAll('[data-testid="SentReceivedSavedTime"]')).filter(isVisible);
    if (newOutlookDateTags.length > 0) {
      const { value, attr } = absoluteDateFromNode(newOutlookDateTags[newOutlookDateTags.length - 1]);
      if (value) {
        matchedDateStr = value;
        debugInfo = { source: 'outlook-date-node-new-ui', attr, raw: value };
      }
    }
  }

  if (!matchedDateStr) {
    const outlookTimeTags = Array.from(document.querySelectorAll('[data-focusable="true"] span, .allowTextSelection span, .O7Pr6')).filter(isVisible);
    for (const tag of outlookTimeTags) {
      const { value, attr } = absoluteDateFromNode(tag);
      if (value.includes("AM") || value.includes("PM") || (value.includes(",") && value.match(/\d/))) {
        matchedDateStr = value;
        debugInfo = { source: 'outlook-date-node', attr, raw: value };
        break;
      }
    }
  }

  if (!matchedDateStr) {
    const fallback = findFallbackDateNode(container ? container.node : null);
    if (fallback) {
      matchedDateStr = fallback.value;
      debugInfo = { source: 'fallback-title-scan', attr: fallback.attr, raw: fallback.value };
    }
  }

  const parsed = matchedDateStr ? new Date(Date.parse(matchedDateStr)) : new Date();
  if (isNaN(parsed.getTime())) {
    debugInfo = { source: 'unparseable-fallback-now', attr: debugInfo.attr, raw: matchedDateStr };
  }
  return { date: isNaN(parsed.getTime()) ? new Date() : parsed, debug: debugInfo };
}

/* Strip quoted/forwarded content so a date mentioned in an earlier message in
   the thread doesn't get parsed as part of the current message. */
function stripQuotedContent(container) {
  const clone = container.cloneNode(true);
  clone.querySelectorAll('.gmail_quote, blockquote, .OutlookMessageHeader, .yj6qo, .adL').forEach(el => el.remove());
  let text = clone.innerText || "";
  const quoteBoundary = text.search(/\n\s*On .{0,120}wrote:\s*\n/i);
  if (quoteBoundary > 0) text = text.slice(0, quoteBoundary);
  return text;
}

function grabActiveEmailBody(container) {
  if (!container) return { text: '', debug: { source: 'none', matchedNodes: 0, rawChars: 0, strippedChars: 0 } };

  const raw = container.node.innerText || '';
  const text = stripQuotedContent(container.node);
  return {
    text,
    debug: {
      source: `${container.platform}-body`,
      matchedNodes: container.matchedNodes,
      rawChars: raw.length,
      strippedChars: raw.length - text.length
    }
  };
}

/* ---------- Parsing ---------- */

function cleanDocumentTitle() {
  if (!document.title) return "Scheduled Event";
  return document.title
    .replace(/ - Outlook| - Gmail/ig, "")
    // Gmail's tab title often ends with the signed-in account's own email
    // (e.g. "Subject - Sender Name - me@gmail.com - Gmail") — strip it so
    // the account owner's address doesn't leak into the event title.
    .replace(/ - [\w.+-]+@[\w-]+\.[a-z]{2,}\s*$/i, "")
    .trim();
}

function parseTextWithBaseDate(text, dateTimeText, baseDate, url, bodyDebug, emailDateDebug, smartCardText) {
  const result = {
    title: cleanDocumentTitle(),
    date: "", time: "", location: "", description: ""
  };

  // When nothing was confidently parsed, leave the field blank rather than
  // guessing — an unfilled field is an obvious prompt for the user to enter
  // it themselves, whereas a wrong guess can get synced to their calendar
  // without them noticing.
  const dateVerbose = DateParser.parseDateFromTextVerbose(dateTimeText, baseDate);
  result.date = dateVerbose.date ? DateParser.formatLocalDate(dateVerbose.date) : "";

  const timeVerbose = DateParser.parseTimeInfoVerbose(dateTimeText);
  result.time = timeVerbose.time || "";
  if (timeVerbose.range) result.durationMinutes = timeVerbose.range.durationMinutes;

  const locationInfo = DateParser.parseLocationFromText(text);
  result.location = locationInfo.location || "";

  const snippet = text.substring(0, 100).replace(/\n/g, ' ').trim();
  const parts = [];
  if (locationInfo.meetingLink) parts.push(`Join: ${locationInfo.meetingLink}`);
  if (snippet) parts.push(snippet);
  parts.push(`Source: ${url}`);
  result.description = parts.join('\n\n');

  result.debug = { body: bodyDebug, emailDate: emailDateDebug, date: dateVerbose, time: timeVerbose, location: locationInfo, smartCard: smartCardText || null };

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
