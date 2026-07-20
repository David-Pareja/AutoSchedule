/**
 * Auto Scheduler Pro - Popup Script
 */
document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const statusEl = document.getElementById('status-text');
  const scanTimeField = document.getElementById('scan-time');
  const syncBtn = document.getElementById('sync-btn');
  const navMain = document.getElementById('nav-main');
  const navSettings = document.getElementById('nav-settings');
  const viewMain = document.getElementById('view-main');
  const viewSettings = document.getElementById('view-settings');
  const themeSelect = document.getElementById('setting-theme');
  const calendarSelect = document.getElementById('setting-calendar');

  // Load Settings & Theme
  chrome.storage.local.get(['theme', 'calendarChoice', 'highlightedEvent'], (data) => {
    themeSelect.value = data.theme || 'auto';
    calendarSelect.value = data.calendarChoice || 'google';
    applyTheme(themeSelect.value);
    
    // Check if triggered via right-click highlight
    if (data.highlightedEvent) {
      populateForm(data.highlightedEvent);
      chrome.storage.local.remove('highlightedEvent');
      setLiveStatus();
    } else {
      executeParser();
    }
  });

  // Tab Switching
  navMain.addEventListener('click', () => {
    navMain.classList.add('active'); navSettings.classList.remove('active');
    viewMain.classList.add('active'); viewSettings.classList.remove('active');
  });
  navSettings.addEventListener('click', () => {
    navSettings.classList.add('active'); navMain.classList.remove('active');
    viewSettings.classList.add('active'); viewMain.classList.remove('active');
  });

  // Settings Handlers
  themeSelect.addEventListener('change', (e) => {
    chrome.storage.local.set({ theme: e.target.value });
    applyTheme(e.target.value);
  });
  calendarSelect.addEventListener('change', (e) => {
    chrome.storage.local.set({ calendarChoice: e.target.value });
  });

  function applyTheme(pref) {
    if (pref === 'dark' || (pref === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }

  function executeParser() {
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
          // Fallback if content script fails
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

  syncBtn.addEventListener('click', () => {
    const title = document.getElementById('event-title').value;
    const dateVal = document.getElementById('event-date').value;
    const timeVal = document.getElementById('event-time').value;
    const duration = parseInt(document.getElementById('event-duration').value || "60");
    const location = document.getElementById('event-location').value;
    const details = document.getElementById('event-desc').value;

    const start = new Date(`${dateVal}T${timeVal}`);
    const end = new Date(start.getTime() + (duration * 60000));
    const provider = calendarSelect.value;

    // Format ISO strings without symbols for URL params
    const isoStart = start.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    const isoEnd = end.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

    let url = "";
    if (provider === 'google') {
      url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${isoStart}/${isoEnd}&details=${encodeURIComponent(details)}&location=${encodeURIComponent(location)}`;
      window.open(url, '_blank');
    } else if (provider === 'outlook') {
      url = `https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=${encodeURIComponent(title)}&startdt=${start.toISOString()}&enddt=${end.toISOString()}&body=${encodeURIComponent(details)}&location=${encodeURIComponent(location)}`;
      window.open(url, '_blank');
    } else {
      // Apple / ICS Download
      const icsData = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nDTSTART:${isoStart}\nDTEND:${isoEnd}\nSUMMARY:${title}\nDESCRIPTION:${details.replace(/\n/g, '\\n')}\nLOCATION:${location}\nEND:VEVENT\nEND:VCALENDAR`;
      url = `data:text/calendar;charset=utf8,${encodeURIComponent(icsData)}`;
      const a = document.createElement('a');
      a.href = url;
      a.download = 'event.ics';
      a.click();
    }
  });
});