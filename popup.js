document.addEventListener('DOMContentLoaded', () => {
  const statusEl = document.getElementById('status-text');
  const scanTimeField = document.getElementById('scan-time');
  const syncBtn = document.getElementById('sync-btn');
  const navMain = document.getElementById('nav-main');
  const navSettings = document.getElementById('nav-settings');
  const viewMain = document.getElementById('view-main');
  const viewSettings = document.getElementById('view-settings');
  const themeSelect = document.getElementById('setting-theme');
  const calendarSelect = document.getElementById('setting-calendar');
  const customColorGroup = document.getElementById('custom-color-group');
  const customColorInput = document.getElementById('setting-custom-color');
  const debugToggle = document.getElementById('setting-debug');
  const debugPanel = document.getElementById('debug-panel');
  const debugLog = document.getElementById('debug-log');

  chrome.storage.local.get(
    ['theme', 'calendarChoice', 'customColor', 'debugMode', 'highlightedEvent', 'lastParsed'],
    (data) => {
      themeSelect.value = data.theme || 'auto';
      calendarSelect.value = data.calendarChoice || 'google';
      customColorInput.value = data.customColor || '#6366f1';
      applyTheme(themeSelect.value, customColorInput.value);

      debugToggle.checked = !!data.debugMode;
      debugPanel.style.display = debugToggle.checked ? 'block' : 'none';

      if (data.highlightedEvent) {
        populateForm(data.highlightedEvent);
        renderDebugPanel(data.highlightedEvent.debug, 'Highlighted selection (right-click)');
        chrome.storage.local.remove('highlightedEvent');
        setLiveStatus();
      } else {
        if (data.lastParsed) renderDebugPanel(data.lastParsed.debug, 'Cached scan');
        executeParser(data.lastParsed);
      }
    }
  );

  navMain.addEventListener('click', () => {
    navMain.classList.add('active'); navSettings.classList.remove('active');
    viewMain.classList.add('active'); viewSettings.classList.remove('active');
  });
  navSettings.addEventListener('click', () => {
    navSettings.classList.add('active'); navMain.classList.remove('active');
    viewSettings.classList.add('active'); viewMain.classList.remove('active');
  });

  themeSelect.addEventListener('change', (e) => {
    chrome.storage.local.set({ theme: e.target.value });
    applyTheme(e.target.value, customColorInput.value);
  });
  calendarSelect.addEventListener('change', (e) => {
    chrome.storage.local.set({ calendarChoice: e.target.value });
  });
  customColorInput.addEventListener('input', (e) => {
    chrome.storage.local.set({ customColor: e.target.value });
    if (themeSelect.value === 'custom') applyTheme('custom', e.target.value);
  });
  debugToggle.addEventListener('change', (e) => {
    chrome.storage.local.set({ debugMode: e.target.checked });
    debugPanel.style.display = e.target.checked ? 'block' : 'none';
    if (e.target.checked) renderDebugPanel(lastDebugTrace, lastDebugContext);
  });

  let lastDebugTrace = null;
  let lastDebugContext = '';

  // Turns the raw parse trace (which selector/attribute/regex a field came
  // from, every date candidate considered and why one won, any time range
  // detected) into a readable log so parsing failures can be diagnosed
  // without opening devtools.
  function renderDebugPanel(trace, context) {
    lastDebugTrace = trace;
    lastDebugContext = context;
    if (!debugToggle.checked) return;
    if (!trace) { debugLog.textContent = 'No parse data yet.'; return; }

    const lines = [`Context: ${context}`];

    if (trace.body) {
      lines.push(`Body source: ${trace.body.source} (${trace.body.rawChars} chars, ${trace.body.strippedChars} stripped as quoted/forwarded)`);
    }
    if (trace.emailDate) {
      const via = trace.emailDate.attr ? ` via ${trace.emailDate.attr}` : '';
      const raw = trace.emailDate.raw ? ` = "${trace.emailDate.raw}"` : '';
      lines.push(`Email date source: ${trace.emailDate.source}${via}${raw}`);
    }

    if (trace.smartCard) {
      lines.push(`Gmail smart-card found: "${trace.smartCard}" (fed in ahead of the body as a "When:" line)`);
    }

    if (trace.date) {
      const candidates = trace.date.candidates || [];
      if (candidates.length) {
        lines.push('Date candidates:');
        candidates.forEach(c => {
          lines.push(`  ${c.isWinner ? '→' : ' '} [${c.source}] "${c.raw}" → ${c.dateLabel} (score ${c.score})`);
        });
      } else {
        lines.push('Date candidates: none found — left blank for manual entry');
      }
    }

    if (trace.time) {
      if (trace.time.range) {
        lines.push(`Time: range ${trace.time.range.start}–${trace.time.range.end} (${trace.time.range.durationMinutes} min) from "${trace.time.raw}" [${trace.time.source}]`);
      } else if (trace.time.time) {
        lines.push(`Time: ${trace.time.time} from "${trace.time.raw}" [${trace.time.source}]`);
      } else {
        lines.push('Time: no match — left blank for manual entry');
      }
    }

    if (trace.location) {
      if (trace.location.meetingLink) {
        lines.push(`Location: Online — join link "${trace.location.meetingLink}" [${trace.location.source}]`);
      } else if (trace.location.location) {
        lines.push(`Location: "${trace.location.location}" from "${trace.location.raw}" [${trace.location.source}]`);
      } else {
        lines.push('Location: no match — left blank for manual entry');
      }
    }

    debugLog.textContent = lines.join('\n');
  }

  function applyTheme(pref, customColor) {
    if (pref === 'dark' || (pref === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }

    customColorGroup.style.display = pref === 'custom' ? 'block' : 'none';

    if (pref === 'custom' && customColor) {
      document.documentElement.style.setProperty('--brand', customColor);
      document.documentElement.style.setProperty('--brand-text', getContrastColor(customColor));
    } else {
      document.documentElement.style.removeProperty('--brand');
      document.documentElement.style.removeProperty('--brand-text');
    }
  }

  function getContrastColor(hex) {
    const r = parseInt(hex.substr(1, 2), 16);
    const g = parseInt(hex.substr(3, 2), 16);
    const b = parseInt(hex.substr(5, 2), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.6 ? '#000000' : '#ffffff';
  }

  function executeParser(cachedParsed) {
    statusEl.innerText = "• Parsing...";
    statusEl.className = "status-indicator status-parsing";

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      const url = tabs[0].url || "";
      const isSupported = url.includes('mail.google') || url.includes('outlook.live') || url.includes('outlook.office') || url.includes('outlook.cloud.microsoft');

      if (!isSupported) {
        statusEl.innerText = "• Offline";
        statusEl.className = "status-indicator status-offline";
        scanTimeField.innerText = "Unsupported Site";
        syncBtn.disabled = true;
        return;
      }

      chrome.tabs.sendMessage(tabs[0].id, { action: "scan_email_content" }, (response) => {
        if (chrome.runtime.lastError || !response || !response.parsedData) {
          if (cachedParsed) {
            populateForm(cachedParsed);
            renderDebugPanel(cachedParsed.debug, 'Cached scan (live message channel unavailable)');
          }
          setLiveStatus();
          return;
        }
        populateForm(response.parsedData);
        renderDebugPanel(response.parsedData.debug, 'Live email scan');
        setLiveStatus();
      });
    });
  }

  function setLiveStatus() {
    statusEl.innerText = "• Live Connection";
    statusEl.className = "status-indicator status-live";
    scanTimeField.innerText = `Scanned: ${new Date().toLocaleTimeString()}`;
    syncBtn.disabled = false;
  }

  function populateForm(data) {
    if (document.getElementById('event-title')) document.getElementById('event-title').value = data.title || "";
    if (document.getElementById('event-date')) document.getElementById('event-date').value = data.date || "";
    if (document.getElementById('event-time')) document.getElementById('event-time').value = data.time || "";
    if (document.getElementById('event-location')) document.getElementById('event-location').value = data.location || "";
    if (document.getElementById('event-desc')) document.getElementById('event-desc').value = data.description || "";
    applyDuration(data.durationMinutes);
  }

  // When a "2-4pm" style range was detected, reflect its real length instead
  // of leaving the default 1-hour duration selected.
  function applyDuration(minutes) {
    const select = document.getElementById('event-duration');
    if (!select || !minutes) return;
    let option = Array.from(select.options).find(o => parseInt(o.value, 10) === minutes);
    if (!option) {
      const prevAuto = select.querySelector('option[data-auto="1"]');
      if (prevAuto) prevAuto.remove();
      option = document.createElement('option');
      option.value = String(minutes);
      option.textContent = `${minutes} Min (detected)`;
      option.dataset.auto = '1';
      select.appendChild(option);
    }
    select.value = String(minutes);
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  // Floating local time, no UTC conversion — prevents the date-shift bug
  function toLocalCalString(d) {
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  // Outlook's deeplink wants ISO-formatted local time (dashes/colons, unlike
  // Google's compact format) with an explicit UTC offset so the wall-clock
  // time the user picked is preserved exactly, instead of being ambiguous.
  function toOutlookCalString(d) {
    const offsetMin = -d.getTimezoneOffset();
    const sign = offsetMin >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMin);
    const offset = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${offset}`;
  }

  syncBtn.addEventListener('click', () => {
    const title = document.getElementById('event-title').value;
    const dateVal = document.getElementById('event-date').value;
    const timeVal = document.getElementById('event-time').value;
    const duration = parseInt(document.getElementById('event-duration').value || "60", 10);
    const location = document.getElementById('event-location').value;
    const details = document.getElementById('event-desc').value;

    if (!dateVal || !timeVal) {
      alert('Date and time could not be confidently parsed from this email — please fill them in before syncing.');
      return;
    }

    const start = new Date(`${dateVal}T${timeVal}`);
    const end = new Date(start.getTime() + duration * 60000);
    const provider = calendarSelect.value;

    const localStart = toLocalCalString(start);
    const localEnd = toLocalCalString(end);

    let url = "";
    if (provider === 'google') {
      url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${localStart}/${localEnd}&details=${encodeURIComponent(details)}&location=${encodeURIComponent(location)}`;
      window.open(url, '_blank');
    } else if (provider === 'outlook') {
      // outlook.office365.com is the general-purpose deeplink host that works
      // for both personal Microsoft accounts and work/school (Microsoft 365)
      // accounts, so users don't need to pick which Outlook flavor they use.
      const params = new URLSearchParams({
        path: '/calendar/action/compose',
        rru: 'addevent',
        startdt: toOutlookCalString(start),
        enddt: toOutlookCalString(end),
        subject: title,
        body: details,
        location
      });
      url = `https://outlook.office365.com/calendar/deeplink/compose?${params.toString()}`;
      window.open(url, '_blank');
    } else {
      const icsData = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nDTSTART:${localStart}\nDTEND:${localEnd}\nSUMMARY:${title}\nDESCRIPTION:${details.replace(/\n/g, '\\n')}\nLOCATION:${location}\nEND:VEVENT\nEND:VCALENDAR`;
      url = `data:text/calendar;charset=utf8,${encodeURIComponent(icsData)}`;
      const a = document.createElement('a');
      a.href = url;
      a.download = 'event.ics';
      a.click();
    }
  });
});