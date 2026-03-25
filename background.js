// background.js — AEM Component Inspector Service Worker

// Cache for component data to avoid redundant fetches
const componentCache = new Map();

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FETCH_COMPONENT_DATA') {
    fetchComponentData(message.path, message.baseUrl)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep message channel open for async response
  }

  if (message.type === 'GET_SETTINGS') {
    chrome.storage.sync.get(['enabled', 'showJSON', 'autoFetch'], (result) => {
      sendResponse({
        enabled: result.enabled !== false, // default true
        showJSON: result.showJSON !== false,
        autoFetch: result.autoFetch !== false
      });
    });
    return true;
  }

  if (message.type === 'TOGGLE_INSPECTOR') {
    chrome.storage.sync.set({ enabled: message.enabled });
    // Notify all AEM tabs
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'INSPECTOR_TOGGLED',
          enabled: message.enabled
        }).catch(() => {});
      });
    });
    sendResponse({ success: true });
    return true;
  }
});

// Fetch component data from AEM JSON API
async function fetchComponentData(path, baseUrl) {
  const cacheKey = `${baseUrl}${path}`;

  if (componentCache.has(cacheKey)) {
    return componentCache.get(cacheKey);
  }

  const results = {};

  try {
    // Fetch component properties
    const propsUrl = `${baseUrl}${path}.infinity.json`;
    const propsRes = await fetch(propsUrl, { credentials: 'include' });
    if (propsRes.ok) {
      results.properties = await propsRes.json();
    }
  } catch (e) {
    results.propertiesError = e.message;
  }

  try {
    // Fetch policy info (1 level up to get cq:policy)
    const parentPath = path.substring(0, path.lastIndexOf('/'));
    const policyUrl = `${baseUrl}${parentPath}.json`;
    const policyRes = await fetch(policyUrl, { credentials: 'include' });
    if (policyRes.ok) {
      const parentData = await policyRes.json();
      const nodeName = path.split('/').pop();
      if (parentData[nodeName] && parentData[nodeName]['cq:policy']) {
        results.policyPath = parentData[nodeName]['cq:policy'];
      }
    }
  } catch (e) {
    // Policy fetch failed silently
  }

  componentCache.set(cacheKey, results);

  // Clear cache after 5 minutes
  setTimeout(() => componentCache.delete(cacheKey), 5 * 60 * 1000);

  return results;
}

// Update badge when inspector is toggled
chrome.storage.onChanged.addListener((changes) => {
  if (changes.enabled) {
    const enabled = changes.enabled.newValue !== false;
    chrome.action.setBadgeText({ text: enabled ? 'ON' : '' });
    chrome.action.setBadgeBackgroundColor({ color: enabled ? '#4f8ef7' : '#6b7280' });
  }
});

// Set initial badge
chrome.storage.sync.get(['enabled'], (result) => {
  const enabled = result.enabled !== false;
  chrome.action.setBadgeText({ text: enabled ? 'ON' : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#4f8ef7' });
});
