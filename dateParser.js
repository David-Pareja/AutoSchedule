/* Shared date/time parsing helpers used by both content.js and background.js */

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_ABBR = { mon: 'monday', tue: 'tuesday', tues: 'tuesday', wed: 'wednesday', thu: 'thursday', thur: 'thursday', thurs: 'thursday', fri: 'friday', sat: 'saturday', sun: 'sunday' };
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
                'august', 'september', 'october', 'november', 'december'];
const MONTH_ABBR = { jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const MONTH_ALT = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec';
const DAY_ALT = 'sunday|monday|tuesday|wednesday|thursday|friday|saturday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun';

const MONTH_DAY_RE = new RegExp(`\\b(${MONTH_ALT})\\.?[ \\t]+(\\d{1,2})(?:st|nd|rd|th)?,?[ \\t]*(\\d{4})?\\b`, 'i');

function monthIndexFromToken(token) {
  const t = token.toLowerCase();
  const full = MONTHS.indexOf(t);
  if (full !== -1) return full;
  return MONTH_ABBR.hasOwnProperty(t) ? MONTH_ABBR[t] : -1;
}

// Lines like "When: Friday, Sept 5, 2-4pm" or "Date: 9/20/2026" are an explicit
// author-stated event date and should always outrank a stray number/word found
// elsewhere in the message. Google Calendar's own invite emails put the label
// alone on a line with the actual date on the next line ("When\nFriday Apr 24,
// 2026 ⋅ 1:30pm – 2:30pm"), so a label with no same-line content falls through
// to the next non-blank line instead of being discarded.
const STRONG_DATE_LABELS = ['when', 'event date', 'meeting date', 'scheduled for', 'scheduled', 'date'];
const STRONG_TIME_LABELS = ['time'];
// Narrower, lower-confidence signal: "on Friday" / "on Aug 27" anywhere in the
// text. Given a smaller bonus than an explicit label line since "on" alone is
// a much noisier word to key off of. The capture is deliberately tight (just
// the weekday, or "month day[, year]") so it can't accidentally sweep in an
// unrelated number later in the same sentence.
const ON_FALLBACK_RE = new RegExp(
  `\\bon\\s+((?:${DAY_ALT})\\b|(?:${MONTH_ALT})\\.?[ \\t]+\\d{1,2}(?:st|nd|rd|th)?,?[ \\t]*(?:\\d{4})?)`, 'i'
);

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
  if (DAY_ABBR[word]) return DAY_ABBR[word];
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

function stripTime(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatLocalDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Requires the label to be the first word on its own (trimmed) line, rather
// than matching "label:"/"label -" anywhere in the text — otherwise a phrase
// like "(Eastern Time - New York)" would be mistaken for a "Time:" label.
function findLineLabeledSegment(text, labels) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    for (const label of labels) {
      const re = new RegExp(`^${label.replace(/ /g, '\\s+')}\\s*[:\\-]?\\s*(.*)$`, 'i');
      const m = line.match(re);
      if (!m) continue;
      let segment = m[1].trim();
      if (!segment) {
        // Deeply nested table/div markup (e.g. a forwarded Google Calendar
        // invite) can render several blank innerText lines between a label
        // heading and its actual content — look a bit further than just the
        // very next line before giving up.
        for (let j = i + 1; j <= i + 6 && j < lines.length; j++) {
          const next = lines[j].trim();
          if (next) { segment = next; break; }
        }
      }
      if (segment.length >= 3) return { label, segment: segment.slice(0, 140) };
    }
  }
  return null;
}

function findLabeledDateSegment(text) {
  const lineMatch = findLineLabeledSegment(text, STRONG_DATE_LABELS);
  if (lineMatch) return { ...lineMatch, bonus: 10 };

  const onMatch = text.match(ON_FALLBACK_RE);
  if (onMatch) {
    // A bare weekday is a much weaker signal than "on Aug 27[, 2026]" — its
    // bonus must stay small enough that specificity(weekday=2) + bonus can
    // never reach specificity(month/numeric-with-year=5 or 6), or a vague
    // "on Tuesday" mention would outrank a precise, unlabeled explicit date
    // sitting elsewhere in the same message.
    const isWeekdayOnly = new RegExp(`^(?:${DAY_ALT})\\b`, 'i').test(onMatch[1]);
    return { label: 'on', segment: onMatch[0].trim().slice(0, 140), bonus: isWeekdayOnly ? 2 : 6 };
  }

  return null;
}

function findLabeledTimeSegment(text) {
  return findLineLabeledSegment(text, STRONG_TIME_LABELS);
}

/* ---------- Date ---------- */

function collectDateCandidates(text, baseDate, bonus, source) {
  const lower = text.toLowerCase();
  const out = [];

  if (/\btoday\b/.test(lower)) {
    out.push({ source, raw: 'today', specificity: 3 + bonus, date: new Date(baseDate), dateLabel: formatLocalDate(baseDate) });
  }
  if (/\btomorrow\b/.test(lower)) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + 1);
    out.push({ source, raw: 'tomorrow', specificity: 3 + bonus, date: d, dateLabel: formatLocalDate(d) });
  }

  // Numeric date: 7/25, 7-25-2026. Scan every occurrence (not just the first)
  // and prefer ones with an explicit year, since a bare "12/25" earlier in the
  // text (e.g. an order number) shouldn't outrank a fully-qualified date later on.
  for (const numericDate of lower.matchAll(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/g)) {
    const month = parseInt(numericDate[1], 10) - 1;
    const day = parseInt(numericDate[2], 10);
    let year = numericDate[3] ? parseInt(numericDate[3], 10) : baseDate.getFullYear();
    if (year < 100) year += 2000;
    if (month >= 0 && month < 12) {
      const d = new Date(year, month, day);
      // Reject silent rollovers (e.g. 2/30 -> March 2)
      if (!isNaN(d.getTime()) && d.getMonth() === month && d.getDate() === day) {
        out.push({ source, raw: numericDate[0], specificity: (numericDate[3] ? 5 : 4) + bonus, date: d, dateLabel: formatLocalDate(d) });
      }
    }
  }

  // "July 25th", "Aug 27th, 2026", "Apr 24" — full or abbreviated month names,
  // with an optional trailing year that's used (and outranks a guessed year)
  // when present.
  const monthMatch = lower.match(MONTH_DAY_RE);
  if (monthMatch) {
    const month = monthIndexFromToken(monthMatch[1]);
    const day = parseInt(monthMatch[2], 10);
    if (month !== -1) {
      const hasYear = !!monthMatch[3];
      const year = hasYear ? parseInt(monthMatch[3], 10) : baseDate.getFullYear();
      const d = new Date(year, month, day);
      if (d.getMonth() === month && d.getDate() === day) {
        if (!hasYear && stripTime(d) < stripTime(baseDate)) d.setFullYear(d.getFullYear() + 1);
        out.push({ source, raw: monthMatch[0].trim(), specificity: (hasYear ? 6 : 5) + bonus, date: d, dateLabel: formatLocalDate(d) });
      }
    }
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
    out.push({ source, raw: (usedNext ? 'next ' : '') + day, specificity: 2 + bonus, date: d, dateLabel: formatLocalDate(d) });
    break;
  }

  return out;
}

// Scores candidates so a same-specificity match that falls chronologically
// soon after baseDate (the likely upcoming event) beats one further away —
// e.g. an old date sitting in a signature block or a far-future placeholder.
function scoreCandidate(c, baseDate) {
  const diffDays = Math.round((stripTime(c.date) - stripTime(baseDate)) / 86400000);
  let proximity;
  if (diffDays >= 0 && diffDays <= 120) proximity = 100 - diffDays;
  else if (diffDays < 0 && diffDays >= -3) proximity = 90 + diffDays;
  else proximity = -Math.abs(diffDays);
  return c.specificity * 1000 + proximity;
}

function parseDateFromTextVerbose(text, baseDate) {
  const labeled = findLabeledDateSegment(text);
  let candidates = [];
  if (labeled) candidates = candidates.concat(collectDateCandidates(labeled.segment, baseDate, labeled.bonus, `label:${labeled.label}`));
  candidates = candidates.concat(collectDateCandidates(text, baseDate, 0, 'body'));

  if (!candidates.length) return { date: null, candidates: [] };

  candidates.forEach(c => { c.score = scoreCandidate(c, baseDate); });
  candidates.sort((a, b) => b.score - a.score);
  candidates[0].isWinner = true;
  return { date: candidates[0].date, candidates };
}

function parseDateFromText(text, baseDate) {
  return parseDateFromTextVerbose(text, baseDate).date;
}

/* ---------- Time ---------- */

function parseSingleTime(text) {
  const lower = text.toLowerCase();
  const patterns = [
    /(?:\bat\b|@)\s*(?<hr>\d{1,2})(?::(?<min>\d{2}))?\s*(?<ampm>am|pm)?/i,
    /\b(?<hr>\d{1,2}):(?<min>\d{2})\s*(?<ampm>am|pm)?\b/i,
    /\b(?<hr>\d{1,2})\s*(?<ampm>am|pm)\b/i
  ];

  for (let idx = 0; idx < patterns.length; idx++) {
    const m = lower.match(patterns[idx]);
    if (m && m.groups && m.groups.hr) {
      let hr = parseInt(m.groups.hr, 10);
      if (hr > 23) continue;
      const min = m.groups.min || "00";
      const ampm = m.groups.ampm;
      // The bare "H:MM" pattern (no am/pm, no "at"/"@") is the least reliable —
      // only accept it in the plausible 1-12 meeting-hour range to cut down on
      // false positives from unrelated numbers (durations, reference codes, etc.)
      if (idx === 1 && !ampm && (hr < 1 || hr > 12)) continue;
      if (ampm === "pm" && hr < 12) hr += 12;
      if (ampm === "am" && hr === 12) hr = 0;
      if (hr > 23) continue;
      return { time: `${hr < 10 ? '0' + hr : hr}:${min}`, raw: m[0].trim() };
    }
  }
  return null;
}

function applyAmPm(hr, min, ampm) {
  let h = hr;
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  return h * 60 + min;
}

function toHHMM(totalMinutes) {
  const pad = n => String(n).padStart(2, '0');
  return `${pad(Math.floor(totalMinutes / 60))}:${pad(totalMinutes % 60)}`;
}

// Detects "2-4pm", "10:00 AM - 11:30 AM", "9am to 11am", "from 2 until 4pm".
function parseTimeRange(text) {
  const re = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;
  const m = text.toLowerCase().match(re);
  if (!m) return null;

  let sh = parseInt(m[1], 10), eh = parseInt(m[4], 10);
  const sm = m[2] ? parseInt(m[2], 10) : 0, em = m[5] ? parseInt(m[5], 10) : 0;
  let sap = m[3], eap = m[6];
  if (sh > 23 || eh > 23) return null;

  // Require at least one am/pm marker or an explicit ":MM" somewhere in the
  // match, otherwise this is more likely a numeric date ("9-11") or an
  // unrelated number range than a time.
  if (!sap && !eap && !m[2] && !m[5]) return null;

  if (!sap && eap) {
    // "2-4pm" -> both pm. "11-4pm" -> 11am to 4pm (a pm start would run past midnight).
    sap = (sh <= eh) ? eap : (eap === 'pm' ? 'am' : 'pm');
  } else if (!eap && sap) {
    eap = sap;
  } else if (!sap && !eap) {
    // Neither side gives am/pm: assume ordinary business hours, so a small
    // hour (<8) reads as afternoon rather than the middle of the night.
    sap = sh < 8 ? 'pm' : 'am';
    eap = eh < 8 ? 'pm' : 'am';
  }

  const startMin = applyAmPm(sh, sm, sap);
  const endMin = applyAmPm(eh, em, eap);
  if (endMin <= startMin) return null; // not a sane same-day range; fall back to single-time parsing

  return { start: toHHMM(startMin), end: toHHMM(endMin), durationMinutes: endMin - startMin, raw: m[0].trim() };
}

function parseTimeInfoVerbose(text) {
  const labeled = findLabeledTimeSegment(text) || findLabeledDateSegment(text);
  const segments = labeled
    ? [{ text: labeled.segment, source: `label:${labeled.label}` }, { text, source: 'body' }]
    : [{ text, source: 'body' }];

  for (const seg of segments) {
    const lower = seg.text.toLowerCase();
    if (/\bnoon\b/.test(lower)) return { time: "12:00", range: null, source: seg.source, raw: 'noon' };
    if (/\bmidnight\b/.test(lower)) return { time: "00:00", range: null, source: seg.source, raw: 'midnight' };
  }

  for (const seg of segments) {
    const range = parseTimeRange(seg.text);
    if (range) return { time: range.start, range, source: seg.source, raw: range.raw };
  }

  for (const seg of segments) {
    const single = parseSingleTime(seg.text);
    if (single) return { time: single.time, range: null, source: seg.source, raw: single.raw };
  }

  return { time: null, range: null, source: null, raw: null };
}

function parseTimeFromText(text) {
  return parseTimeInfoVerbose(text).time;
}

/* ---------- Location ---------- */

const STRONG_LOCATION_LABELS = ['location', 'venue', 'where', 'address'];

// A join link is a much stronger, unambiguous signal than any freeform
// address text — if one is present, the event is (at least primarily) a
// video call, so the location becomes "Online" and the actual link is
// surfaced separately for the description rather than jammed into the
// location field.
const MEETING_LINK_RE = /\bhttps?:\/\/(?:[\w-]+\.)*(zoom\.us|teams\.microsoft\.com|teams\.live\.com|meet\.google\.com|webex\.com|gotomeeting\.com|gotomeet\.me|bluejeans\.com|whereby\.com|meetings\.hubspot\.com|chime\.aws)\/[^\s<>"')\]]+/i;

// Client-side, regex-only US street-address recognizer: NUMBER + STREET NAME +
// SUFFIX, optionally more free text (a suite/floor/building name), then a
// ", ST ZIP[-ZIP4]" tail. This is intentionally light — no delivery/city-name
// validation — since it only needs to fill in a location field for the user
// to double check, not certify the address is real.
const STREET_SUFFIX_ALT = 'street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|lane|ln|way|court|ct|plaza|plz|circle|cir|place|pl|highway|hwy|parkway|pkwy|terrace|ter|trail|trl|square|sq';
const ADDRESS_RE = new RegExp(
  `\\b\\d{1,6}\\s+[A-Za-z0-9.'#-]+(?:\\s+[A-Za-z0-9.'#-]+){0,5}\\s+(?:${STREET_SUFFIX_ALT})\\.?\\b[^\\n\\r]{0,60}?,\\s*[A-Z]{2}\\s*\\d{5}(?:-\\d{4})?\\b`,
  'i'
);

function findLabeledLocationSegment(text) {
  return findLineLabeledSegment(text, STRONG_LOCATION_LABELS);
}

function parseLocationFromText(text) {
  const directLink = text.match(MEETING_LINK_RE);
  if (directLink) {
    return { location: 'Online', meetingLink: directLink[0], source: 'meeting-link', raw: directLink[0] };
  }

  const labeled = findLabeledLocationSegment(text);
  if (labeled) {
    // A labeled location can itself just be a join link ("Location: https://zoom.us/j/123").
    const innerLink = labeled.segment.match(MEETING_LINK_RE);
    if (innerLink) {
      return { location: 'Online', meetingLink: innerLink[0], source: `label:${labeled.label}`, raw: innerLink[0] };
    }
    return { location: labeled.segment, meetingLink: null, source: `label:${labeled.label}`, raw: labeled.segment };
  }

  const addressMatch = text.match(ADDRESS_RE);
  if (addressMatch) {
    return { location: addressMatch[0].trim(), meetingLink: null, source: 'address-pattern', raw: addressMatch[0].trim() };
  }

  return { location: null, meetingLink: null, source: null, raw: null };
}

const DateParser = {
  parseDateFromText,
  parseDateFromTextVerbose,
  parseTimeFromText,
  parseTimeInfoVerbose,
  parseLocationFromText,
  formatLocalDate
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DateParser;
} else {
  self.DateParser = DateParser;
}
