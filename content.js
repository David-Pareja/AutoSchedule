/**
 * Auto Scheduler Pro - Content Script
 */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "scan_email_content") {
    const emailBody = grabActiveEmailBody();
    const emailDate = grabActiveEmailDate();
    const currentUrl = window.location.href; // Capture page URL
    
    const parsed = parseTextWithBaseDate(emailBody, emailDate, currentUrl);
    sendResponse({ parsedData: parsed });
  }
  return true;
});

function grabActiveEmailDate() {
  let matchedDateStr = "";
  const gmailTimeTags = document.querySelectorAll('.g3, .xo, span[role="gridcell"], .gE.iv');
  if (gmailTimeTags.length > 0) matchedDateStr = gmailTimeTags[gmailTimeTags.length - 1].innerText || "";
  
  if (!matchedDateStr) {
    const outlookTimeTags = document.querySelectorAll('[data-focusable="true"] span, .allowTextSelection span, .O7Pr6');
    for (const tag of outlookTimeTags) {
      const text = tag.innerText || "";
      if (text.includes("AM") || text.includes("PM") || (text.includes(",") && text.match(/\d/))) {
        matchedDateStr = text; break;
      }
    }
  }
  return matchedDateStr ? new Date(Date.parse(matchedDateStr)) : new Date();
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

function parseTextWithBaseDate(text, baseDate, url) {
  const result = {
    title: document.title ? document.title.replace(/ - Outlook| - Gmail/ig, "") : "Schedule Alignment",
    date: "", time: "10:00", location: "Online", description: ""
  };

  let calculatedDate = new Date(baseDate);
  const days = { sunday:0, monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6 };
  let found = false;

  // "Next [weekday]"
  const nextMatch = text.match(/next\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/i);
  if (nextMatch) {
    let dist = days[nextMatch[1].toLowerCase()] - baseDate.getDay();
    if (dist <= 0) dist += 7;
    calculatedDate.setDate(baseDate.getDate() + dist + 7);
    found = true;
  }

  // Fallback to tomorrow
  if (!found) calculatedDate.setDate(baseDate.getDate() + 1);

  result.date = calculatedDate.toISOString().split('T')[0];

  const timeMatch = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\b/i);
  if (timeMatch) {
    let hr = parseInt(timeMatch[1]);
    const min = timeMatch[2] || "00";
    const ampm = timeMatch[3] ? timeMatch[3].toUpperCase() : null;
    if (ampm === "PM" && hr < 12) hr += 12;
    if (ampm === "AM" && hr === 12) hr = 0;
    result.time = `${hr < 10 ? '0'+hr : hr}:${min}`;
  }

  // Append Hyperlink Markdown
  const snippet = text.substring(0, 100).replace(/\n/g, ' ');
  result.description = `Parsed Content:\n"${snippet}..."\n\nSource: [Email Link](${url})`;

  return result;
}