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

  chrome.storage.local.get(
    ['theme', 'calendarChoice', 'customColor', 'highlightedEvent', 'lastParsed'],
    (data) => {
      themeSelect.value = data.theme || 'auto';
      calendarSelect.value = data.calendarChoice || 'google';
      customColorInput.value = data.customColor || '#6366f1';
      applyTheme(themeSelect.value, customColorInput.value);

      if (data.highlightedEvent) {
        populateForm(data.highlightedEvent);
        chrome.storage.local.remove('highlightedEvent');
        setLiveStatus();
      } else {
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
      const isSupported = url.includes('mail.google') || url.includes('outlook.live') || url.includes('outlook.office');

      if (!isSupported) {
        statusEl.innerText = "• Offline";
        statusEl.className = "status-indicator status-offline";
        scanTimeField.innerText = "Unsupported Site";
        syncBtn.disabled = true;
        return;
      }

      chrome.tabs.sendMessage(tabs[0].id, { action: "scan_email_content" }, (response) => {
        if (chrome.runtime.lastError || !response || !response.parsedData) {
          if (cachedParsed) populateForm(cachedParsed);
          setLiveStatus();
          return;
        }
        populateForm(response.parsedData);
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
    if (document.getElementById('event-time')) document.getElementById('event-time').value = data.time || "10:00";
    if (document.getElementById('event-location')) document.getElementById('event-location').value = data.location || "";
    if (document.getElementById('event-desc')) document.getElementById('event-desc').value = data.description || "";
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  // Floating local time, no UTC conversion — prevents the date-shift bug
  function toLocalCalString(d) {
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  syncBtn.addEventListener('click', () => {
    const title = document.getElementById('event-title').value;
    const dateVal = document.getElementById('event-date').value;
    const timeVal = document.getElementById('event-time').value;
    const duration = parseInt(document.getElementById('event-duration').value || "60", 10);
    const location = document.getElementById('event-location').value;
    const details = document.getElementById('event-desc').value;

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
      url = `https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=${encodeURIComponent(title)}&startdt=${localStart}&enddt=${localEnd}&body=${encodeURIComponent(details)}&location=${encodeURIComponent(location)}`;
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