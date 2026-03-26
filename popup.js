// popup.js — AEM Inspector Popup Logic

document.addEventListener('DOMContentLoaded', () => {

  // ── Load settings ─────────────────────────────────────────────────────────
  chrome.storage.sync.get(['enabled', 'autoFetch', 'showJSON', 'showHighlight', 'theme'], (settings) => {
    const enabled = settings.enabled !== false;
    const autoFetch = settings.autoFetch !== false;
    const showJSON = settings.showJSON !== false;
    const showHighlight = settings.showHighlight !== false;

    setMainToggle(enabled);
    setMiniToggle('toggle-fetch', autoFetch);
    setMiniToggle('toggle-json', showJSON);
    setMiniToggle('toggle-highlight', showHighlight);

    const savedTheme = settings.theme || 'dark';
    setTheme(savedTheme);
    document.documentElement.setAttribute('data-theme', savedTheme);
  });

  // ── Detect current tab environment ────────────────────────────────────────
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.url) return;

    try {
      const url = new URL(tab.url);
      const host = url.hostname;

      document.getElementById('env-host').textContent = host.length > 28
        ? host.substring(0, 25) + '...'
        : host;

      // Determine environment mode
      const modeEl = document.getElementById('env-mode');
      if (host.includes('localhost') || host.includes('127.0.0.1')) {
        modeEl.textContent = 'LOCAL';
        modeEl.className = 'env-badge local';
        document.getElementById('env-version').textContent = 'AEM SDK';
      } else if (url.pathname.includes('/editor.html') || host.includes('author')) {
        modeEl.textContent = 'AUTHOR';
        modeEl.className = 'env-badge author';
        document.getElementById('env-version').textContent = 'AEM as Cloud';
      } else if (host.includes('publish') || host.includes('.aem.page')) {
        modeEl.textContent = 'PUBLISH';
        modeEl.className = 'env-badge publish';
        document.getElementById('env-version').textContent = 'AEM as Cloud';
      } else {
        modeEl.textContent = 'UNKNOWN';
        modeEl.className = 'env-badge unknown';
        document.getElementById('env-version').textContent = '—';
      }
    } catch (e) {
      // Invalid URL
    }
  });

  // ── Main Toggle ───────────────────────────────────────────────────────────
  document.getElementById('main-toggle').addEventListener('click', function () {
    const isOn = this.classList.contains('on');
    const newState = !isOn;

    setMainToggle(newState);
    chrome.storage.sync.set({ enabled: newState });

    // Tell content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'INSPECTOR_TOGGLED',
          enabled: newState
        }).catch(() => {});
      }
    });

    // Update badge
    chrome.runtime.sendMessage({ type: 'TOGGLE_INSPECTOR', enabled: newState });
  });

  document.getElementById('theme-toggle').addEventListener('click', function () {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    setTheme(newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    chrome.storage.sync.set({ theme: newTheme });
    
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'THEME_CHANGED',
          theme: newTheme
        }).catch(() => {});
      }
    });
  });

  function setTheme(theme) {
    const btn = document.getElementById('theme-toggle');
    btn.textContent = theme === 'dark' ? '🌙' : '☀️';
    btn.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  }

  // ── Mini Toggles ──────────────────────────────────────────────────────────
  document.getElementById('toggle-fetch').addEventListener('click', function () {
    const newState = !this.classList.contains('on');
    setMiniToggle('toggle-fetch', newState);
    chrome.storage.sync.set({ autoFetch: newState });
  });

  document.getElementById('toggle-json').addEventListener('click', function () {
    const newState = !this.classList.contains('on');
    setMiniToggle('toggle-json', newState);
    chrome.storage.sync.set({ showJSON: newState });
  });

  document.getElementById('toggle-highlight').addEventListener('click', function () {
    const newState = !this.classList.contains('on');
    setMiniToggle('toggle-highlight', newState);
    chrome.storage.sync.set({ showHighlight: newState });
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  function setMainToggle(enabled) {
    const toggle = document.getElementById('main-toggle');
    const dot = document.getElementById('status-dot');
    const label = document.getElementById('status-label');
    const desc = document.getElementById('status-desc');

    if (enabled) {
      toggle.classList.add('on');
      dot.classList.remove('off');
      label.textContent = 'Inspector Active';
      desc.textContent = 'Hover components to inspect';
    } else {
      toggle.classList.remove('on');
      dot.classList.add('off');
      label.textContent = 'Inspector Off';
      desc.textContent = 'Click to enable';
    }
  }

  function setMiniToggle(id, state) {
    const el = document.getElementById(id);
    if (state) el.classList.add('on');
    else el.classList.remove('on');
  }
});
