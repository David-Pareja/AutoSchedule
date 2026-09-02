document.addEventListener('DOMContentLoaded', () => {
  const statusEl = document.getElementById('status-text');
  const scanTimeField = document.getElementById('scan-time');
  const syncBtn = document.getElementById('sync-btn');
  const navMain = document.getElementById('nav-main');
  const navSettings = document.getElementById('nav-settings');
  const navInfo = document.getElementById('nav-info');
  const viewMain = document.getElementById('view-main');
  const viewSettings = document.getElementById('view-settings');
  const viewInfo = document.getElementById('view-info');
  const unsupportedBanner = document.getElementById('unsupported-banner');
  const dismissForeverBtn = document.getElementById('dismiss-forever-btn');
  const whitelistListEl = document.getElementById('whitelist-list');
  const whitelistInput = document.getElementById('whitelist-input');
  const whitelistAddBtn = document.getElementById('whitelist-add-btn');
  const themeSelect = document.getElementById('setting-theme');
  const calendarSelect = document.getElementById('setting-calendar');
  const customColorGroup = document.getElementById('custom-color-group');
  const customColorInput = document.getElementById('setting-custom-color');
  const debugToggle = document.getElementById('setting-debug');
  const debugPanel = document.getElementById('debug-panel');
  const debugLog = document.getElementById('debug-log');
  const noAnimToggle = document.getElementById('setting-no-animations');
  const tabIndicator = document.getElementById('tab-indicator');
  const tabViewport = document.querySelector('.tab-viewport');

  const infoVersionEl = document.getElementById('info-version');
  if (infoVersionEl) infoVersionEl.textContent = `v${chrome.runtime.getManifest().version}`;

  const DEFAULT_WHITELIST = ['mail.google.com', 'outlook.live.com', 'outlook.office.com', 'outlook.office365.com', 'outlook.cloud.microsoft'];
  let currentWhitelist = DEFAULT_WHITELIST.slice();
  let currentHostname = '';
  let siteIsUnsupportedLocked = false;

  chrome.storage.local.get(
    ['theme', 'calendarChoice', 'customColor', 'debugMode', 'animationsDisabled', 'hasOpenedPopupBefore', 'whitelistedSites', 'highlightedEvent', 'lastParsed'],
    (data) => {
      themeSelect.value = data.theme || 'auto';
      calendarSelect.value = data.calendarChoice || 'google';
      customColorInput.value = data.customColor || '#6366f1';
      applyTheme(themeSelect.value, customColorInput.value);

      debugToggle.checked = !!data.debugMode;
      debugPanel.style.display = debugToggle.checked ? 'block' : 'none';

      noAnimToggle.checked = !!data.animationsDisabled;
      document.documentElement.classList.toggle('no-animations', noAnimToggle.checked);

      currentWhitelist = Array.isArray(data.whitelistedSites) ? data.whitelistedSites : DEFAULT_WHITELIST.slice();
      if (!Array.isArray(data.whitelistedSites)) chrome.storage.local.set({ whitelistedSites: currentWhitelist });
      renderWhitelist(currentWhitelist);

      const isFirstOpen = !data.hasOpenedPopupBefore;
      chrome.storage.local.set({ hasOpenedPopupBefore: true });
      runIntroAnimation(isFirstOpen, noAnimToggle.checked);
      positionTabIndicator(navMain);

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

  // Elements animated in top-to-bottom on popup open: the header, the tab
  // bar, then every top-level field group of the (visible-by-default)
  // Schedule view. First-ever open gets a slower, richer "grow in" over 2s;
  // every open after that gets a quicker plain fade over 0.6s (fast enough
  // not to be annoying once the novelty of the first run has worn off).
  function runIntroAnimation(isFirstOpen, animationsDisabled) {
    if (animationsDisabled) return;

    const elements = [document.querySelector('.header'), document.querySelector('.tab-bar'), ...Array.from(viewMain.children)];
    const totalDuration = isFirstOpen ? 2000 : 600;
    const singleDuration = isFirstOpen ? 450 : 220;
    const animationName = isFirstOpen ? 'pop-in' : 'fade-in';
    const delayStep = elements.length > 1 ? (totalDuration - singleDuration) / (elements.length - 1) : 0;

    elements.forEach((el, i) => {
      el.style.opacity = '0';
      el.style.animation = `${animationName} ${singleDuration}ms ease ${Math.round(i * delayStep)}ms forwards`;
    });
  }

  // Slides the shared underline bar under whichever tab button is active.
  function positionTabIndicator(btn) {
    const barRect = tabIndicator.parentElement.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    tabIndicator.style.width = `${btnRect.width}px`;
    tabIndicator.style.transform = `translateX(${btnRect.left - barRect.left}px)`;
  }

  const TAB_VIEWS = { main: viewMain, settings: viewSettings, info: viewInfo };
  const TAB_BTNS = { main: navMain, settings: navSettings, info: navInfo };
  const TAB_ORDER = ['main', 'settings', 'info'];
  let currentTab = 'main';

  // Swaps the Schedule/Settings panels with a "swipe to the next desktop"
  // style transition: the outgoing panel and incoming panel briefly overlap
  // (absolutely positioned) and slide past each other in the direction that
  // matches moving forward/backward through the tab order.
  function switchTab(target) {
    if (target === currentTab) return;
    const outgoingView = TAB_VIEWS[currentTab];
    const incomingView = TAB_VIEWS[target];
    TAB_BTNS[currentTab].classList.remove('active');
    TAB_BTNS[target].classList.add('active');
    positionTabIndicator(TAB_BTNS[target]);

    if (document.documentElement.classList.contains('no-animations')) {
      outgoingView.classList.remove('active');
      incomingView.classList.add('active');
      currentTab = target;
      return;
    }

    const goingForward = TAB_ORDER.indexOf(target) > TAB_ORDER.indexOf(currentTab);
    const startHeight = outgoingView.offsetHeight;

    tabViewport.style.height = `${startHeight}px`;
    outgoingView.classList.add('sliding');
    incomingView.classList.add('sliding', 'active');
    incomingView.style.transition = 'none';
    incomingView.style.transform = `translateX(${goingForward ? '100%' : '-100%'})`;
    incomingView.offsetHeight; // force reflow before re-enabling the transition
    incomingView.style.transition = '';

    const endHeight = incomingView.scrollHeight;
    requestAnimationFrame(() => {
      outgoingView.style.transform = `translateX(${goingForward ? '-100%' : '100%'})`;
      incomingView.style.transform = 'translateX(0)';
      tabViewport.style.transition = 'height 0.3s ease';
      tabViewport.style.height = `${endHeight}px`;
    });

    setTimeout(() => {
      outgoingView.classList.remove('active', 'sliding');
      outgoingView.style.transform = '';
      incomingView.classList.remove('sliding');
      incomingView.style.transform = '';
      tabViewport.style.height = '';
      tabViewport.style.transition = '';
      currentTab = target;
    }, 320);
  }

  // Greys out the Schedule tab on an unsupported site: single-clicking it
  // does nothing (a tooltip explains why on hover), but double-clicking
  // unlocks manual entry for the rest of this popup session and reveals the
  // "Dismiss forever" banner. The lock reappears on the next open unless the
  // user dismisses it forever for this site.
  function lockScheduleTab() {
    siteIsUnsupportedLocked = true;
    navMain.classList.add('tab-locked');
    navMain.title = "This site isn't supported for auto-parsing. Double-click to add event details manually and export to your calendar.";
  }

  function unlockScheduleTab() {
    siteIsUnsupportedLocked = false;
    navMain.classList.remove('tab-locked');
    navMain.removeAttribute('title');
    syncBtn.disabled = false;
    unsupportedBanner.style.display = 'flex';
    if (currentTab !== 'main') switchTab('main');
  }

  navMain.addEventListener('click', () => {
    if (siteIsUnsupportedLocked) return;
    switchTab('main');
  });
  navMain.addEventListener('dblclick', () => {
    if (siteIsUnsupportedLocked) unlockScheduleTab();
  });
  navSettings.addEventListener('click', () => switchTab('settings'));
  navInfo.addEventListener('click', () => switchTab('info'));

  dismissForeverBtn.addEventListener('click', () => {
    unsupportedBanner.style.display = 'none';
    if (!currentHostname) return;
    chrome.storage.local.get(['dismissedUnsupportedHosts'], (data) => {
      const list = Array.isArray(data.dismissedUnsupportedHosts) ? data.dismissedUnsupportedHosts : [];
      if (!list.includes(currentHostname)) {
        list.push(currentHostname);
        chrome.storage.local.set({ dismissedUnsupportedHosts: list });
      }
    });
  });

  noAnimToggle.addEventListener('change', (e) => {
    chrome.storage.local.set({ animationsDisabled: e.target.checked });
    document.documentElement.classList.toggle('no-animations', e.target.checked);
  });

  // ---------- Whitelist ----------

  function getHostname(url) {
    try { return new URL(url).hostname; } catch (e) { return ''; }
  }

  function normalizeHostInput(raw) {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname;
    } catch (e) {
      return null;
    }
  }

  function renderWhitelist(list) {
    whitelistListEl.innerHTML = '';
    list.forEach((host) => {
      const row = document.createElement('div');
      row.className = 'whitelist-item';
      const label = document.createElement('span');
      label.textContent = host;
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'remove-btn';
      removeBtn.textContent = '×';
      removeBtn.setAttribute('aria-label', `Remove ${host}`);
      removeBtn.addEventListener('click', () => {
        currentWhitelist = currentWhitelist.filter((h) => h !== host);
        chrome.storage.local.set({ whitelistedSites: currentWhitelist });
        renderWhitelist(currentWhitelist);
      });
      row.appendChild(label);
      row.appendChild(removeBtn);
      whitelistListEl.appendChild(row);
    });
  }

  whitelistAddBtn.addEventListener('click', addWhitelistEntry);
  whitelistInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addWhitelistEntry();
  });

  function addWhitelistEntry() {
    const hostname = normalizeHostInput(whitelistInput.value);
    whitelistInput.value = '';
    if (!hostname || currentWhitelist.includes(hostname)) return;
    currentWhitelist.push(hostname);
    chrome.storage.local.set({ whitelistedSites: currentWhitelist });
    renderWhitelist(currentWhitelist);
  }

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

  function setStatusIndicator(stateClass, label) {
    statusEl.className = `status-indicator ${stateClass}`;
    statusEl.innerHTML = `<span class="status-dot"></span>${label}`;
  }

  const NATIVE_HOSTS = ['mail.google.com', 'outlook.live.com', 'outlook.office.com', 'outlook.office365.com', 'outlook.cloud.microsoft'];

  function isNativeHost(hostname) {
    return NATIVE_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
  }

  // native = Gmail/Outlook, with real selector-based parsing built in.
  // whitelisted = a site the user added; we still attempt to scan it (via
  // on-demand script injection, since it isn't a declared content-script
  // host) but the built-in selectors almost certainly won't match its DOM.
  // unsupported = neither — never bother parsing, to save resources.
  function classifySite(hostname) {
    if (isNativeHost(hostname)) return 'native';
    if (currentWhitelist.includes(hostname)) return 'whitelisted';
    return 'unsupported';
  }

  function executeParser(cachedParsed) {
    setStatusIndicator('status-parsing', 'Parsing...');
    unsupportedBanner.style.display = 'none';
    navMain.classList.remove('tab-locked');
    navMain.removeAttribute('title');
    siteIsUnsupportedLocked = false;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      const url = tabs[0].url || "";
      currentHostname = getHostname(url);
      const status = classifySite(currentHostname);

      if (status === 'unsupported') {
        setStatusIndicator('status-offline', 'Unsupported Site');
        scanTimeField.innerText = "Not on whitelist";
        syncBtn.disabled = true;
        chrome.storage.local.get(['dismissedUnsupportedHosts'], (data) => {
          const dismissed = Array.isArray(data.dismissedUnsupportedHosts) && data.dismissedUnsupportedHosts.includes(currentHostname);
          if (dismissed) {
            syncBtn.disabled = false;
          } else {
            lockScheduleTab();
          }
        });
        return;
      }

      if (status === 'native') {
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
        return;
      }

      // Whitelisted, non-native site: the static content_scripts declaration
      // never matches here, so inject on demand via activeTab + scripting
      // (granted for the tab the popup was opened against) and try anyway.
      chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, files: ['dateParser.js', 'content.js'] })
        .then(() => {
          chrome.tabs.sendMessage(tabs[0].id, { action: "scan_email_content" }, (response) => {
            if (chrome.runtime.lastError || !response || !response.parsedData) {
              if (cachedParsed) {
                populateForm(cachedParsed);
                renderDebugPanel(cachedParsed.debug, 'Cached scan (whitelisted site, live channel unavailable)');
              }
              setWhitelistedStatus();
              return;
            }
            populateForm(response.parsedData);
            renderDebugPanel(response.parsedData.debug, 'Live email scan (whitelisted site)');
            setWhitelistedStatus();
          });
        })
        .catch(() => setWhitelistedStatus());
    });
  }

  function setLiveStatus() {
    setStatusIndicator('status-live', 'Supported Site');
    scanTimeField.innerText = `Scanned: ${new Date().toLocaleTimeString()}`;
    syncBtn.disabled = false;
  }

  function setWhitelistedStatus() {
    setStatusIndicator('status-warning', 'Unsupported');
    scanTimeField.innerText = 'Might not work as intended';
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