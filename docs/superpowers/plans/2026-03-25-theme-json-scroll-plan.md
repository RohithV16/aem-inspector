# Theme, JSON & Scroll Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add light/dark mode toggle, full JSON tree in expanded view, fix CRXDE path encoding, and add auto-scroll to component

**Architecture:** CSS custom properties with data-theme attribute for theming, dynamic depth limit for JSON tree, encodeURIComponent for paths, scrollIntoView for auto-scroll

**Tech Stack:** Chrome Extension (manifest v3), vanilla JS, CSS

---

## File Structure

- `popup.html` - Add theme toggle button, light theme CSS variables
- `popup.js` - Add theme toggle handler, load/save theme preference, send theme to content script
- `content.js` - Fix CRXDE encoding, add auto-scroll, modify tree depth logic for expanded view
- `tooltip.css` - Add light theme styles

---

## Task 1: Add Light/Dark Mode to Popup

### Files:
- Modify: `popup.html:1-433`
- Modify: `popup.js:1-121`

- [ ] **Step 1: Add light theme CSS variables to popup.html**

Add this after existing `:root` variables (around line 22):

```css
[data-theme="light"] {
  --bg: #ffffff;
  --panel: #f8fafc;
  --border: #e2e8f0;
  --accent: #3b82f6;
  --green: #10b981;
  --yellow: #f59e0b;
  --red: #ef4444;
  --text: #1e293b;
  --sub: #64748b;
  --muted: #cbd5e1;
}
```

- [ ] **Step 2: Add theme toggle button to popup header**

Add after version-badge div (around line 349):

```html
<button class="theme-toggle" id="theme-toggle" title="Toggle theme">🌙</button>
```

Add CSS for theme toggle button in popup.html style (after .version-badge):

```css
.theme-toggle {
  background: var(--border);
  border: 1px solid var(--muted);
  border-radius: 6px;
  padding: 4px 8px;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.2s;
}
.theme-toggle:hover {
  background: var(--muted);
}
```

- [ ] **Step 3: Update popup.js to handle theme toggle**

Add `theme` to storage keys (line 6):

```javascript
chrome.storage.sync.get(['enabled', 'autoFetch', 'showJSON', 'showHighlight', 'theme'], (settings) => {
```

Add theme loading after toggles (after line 16):

```javascript
const savedTheme = settings.theme || 'dark';
setTheme(savedTheme);
document.documentElement.setAttribute('data-theme', savedTheme);
```

Add theme toggle handler after main toggle (around line 75):

```javascript
document.getElementById('theme-toggle').addEventListener('click', function () {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  
  setTheme(newTheme);
  document.documentElement.setAttribute('data-theme', newTheme);
  chrome.storage.sync.set({ theme: newTheme });
  
  // Send theme to content script
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
```

---

## Task 2: Add Light Theme to Tooltip CSS

### Files:
- Modify: `tooltip.css:1-462`

- [ ] **Step 1: Add light theme CSS variables**

Add at top of tooltip.css after @import:

```css
[data-theme="light"] {
  --aemi-bg: #ffffff;
  --aemi-panel: #f8fafc;
  --aemi-border: #e2e8f0;
  --aemi-accent: #3b82f6;
  --aemi-green: #10b981;
  --aemi-yellow: #f59e0b;
  --aemi-red: #ef4444;
  --aemi-text: #1e293b;
  --aemi-sub: #64748b;
  --aemi-muted: #cbd5e1;
  --aemi-deep-bg: #f1f5f9;
}
```

- [ ] **Step 2: Update tooltip CSS to use theme variables**

Replace hardcoded dark colors with CSS variables throughout. Key replacements:
- `#0d0f14` → `var(--aemi-bg, #0d0f14)`
- `#111520` → `var(--aemi-panel, #111520)`
- `#1e2230` → `var(--aemi-border, #1e2230)`
- `#4f8ef7` → `var(--aemi-accent, #4f8ef7)`
- `#e2e8f0` → `var(--aemi-text, #e2e8f0)`
- `#64748b` → `var(--aemi-sub, #64748b)`
- `#374151` → `var(--aemi-muted, #374151)`
- `#0f1420` → dark gradient background (keep for header in dark, add light header for light)

Add to tooltip root:
```css
#aem-inspector-tooltip {
  background: var(--aemi-bg, #0d0f14) !important;
  border-color: var(--aemi-accent, #4f8ef7) !important;
  color: var(--aemi-text, #e2e8f0) !important;
}
```

Add light header gradient:
```css
[data-theme="light"] #aem-inspector-tooltip .aemi-header {
  background: linear-gradient(135deg, #f8fafc, #e2e8f0) !important;
  border-bottom-color: var(--aemi-border, #e2e8f0) !important;
}
```

---

## Task 3: Add Theme Handling in Content Script

### Files:
- Modify: `content.js:1-619`

- [ ] **Step 1: Add theme state variable**

Add after other state variables (around line 14):

```javascript
let currentTheme = 'dark';
```

- [ ] **Step 2: Add theme change listener**

Add in init() after message listener (around line 47):

```javascript
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'INSPECTOR_TOGGLED') {
    // existing code...
  }
  if (message.type === 'THEME_CHANGED') {
    currentTheme = message.theme;
    document.documentElement.setAttribute('data-theme', currentTheme);
  }
});
```

- [ ] **Step 3: Load theme on init**

Add in init() after load settings (around line 34):

```javascript
chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (response) => {
  if (response) {
    inspectorEnabled = response.enabled;
    currentTheme = response.theme || 'dark';
    document.documentElement.setAttribute('data-theme', currentTheme);
  }
  if (inspectorEnabled) activateInspector();
});
```

---

## Task 4: Fix CRXDE Path Encoding

### Files:
- Modify: `content.js:300-313`

- [ ] **Step 1: Fix CRXDE button click handler**

Replace lines 300-302:

```javascript
document.getElementById('aemi-crxde').addEventListener('click', () => {
  const encodedPath = encodeURIComponent(currentPath);
  window.open(`${currentBaseUrl}/crx/de#${encodedPath}`, '_blank');
});
```

- [ ] **Step 2: Fix Policy button click handler**

Replace lines 308-313:

```javascript
document.getElementById('aemi-policy-btn').addEventListener('click', () => {
  const policyPath = document.getElementById('aemi-policy-path').textContent;
  if (policyPath && policyPath !== '—') {
    const encodedPath = encodeURIComponent(policyPath);
    window.open(`${currentBaseUrl}/crx/de#${encodedPath}`, '_blank');
  }
});
```

---

## Task 5: Add Auto-scroll to Component

### Files:
- Modify: `content.js:320-337`

- [ ] **Step 1: Add scroll logic in populateTooltip**

Add after getting component element reference:

```javascript
function populateTooltip(el) {
  const data = extractComponentData(el);
  currentPath = data.path;

  // Scroll component into view if not visible
  const rect = el.getBoundingClientRect();
  const isVisible = rect.top >= 0 && rect.bottom <= window.innerHeight && 
                    rect.left >= 0 && rect.right <= window.innerWidth;
  if (!isVisible) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ... rest of existing code
}
```

---

## Task 6: Full JSON Tree in Expanded View

### Files:
- Modify: `content.js:405-427`

- [ ] **Step 1: Modify renderTreeNode to use isExpanded**

Replace the depth check in renderTreeNode (around line 406-412):

```javascript
function renderTreeNode(key, value, depth, container, autoExpand) {
  // Use higher depth limit when expanded
  const maxDepth = isExpanded ? 10 : 2;
  
  if (depth > maxDepth) {
    const link = document.createElement('div');
    link.className = 'aemi-prop-row aemi-tree-deep-link';
    link.innerHTML = `<span class="aemi-key">${key}</span><span class="aemi-val aemi-val--path" onclick="window.open('${currentBaseUrl}${currentPath}.infinity.json','_blank')">{ } Open in JSON</span>`;
    container.appendChild(link);
    return;
  }
  // ... rest of existing code
}
```

- [ ] **Step 2: Expand panel width in CSS for expanded view**

Add to tooltip.css after expanded styles (around line 97):

```css
#aem-inspector-tooltip.aemi--expanded {
  width: 550px !important;
  max-width: 60vw !important;
}
```

- [ ] **Step 3: Make tree nodes expand/collapse work better in expanded mode**

Update autoExpand to always expand root level when expanded:

```javascript
// In renderObjectAsTree (around line 383-386)
nested.forEach(([key, val]) => {
  const autoExpand = depth === 0 || isExpanded;
  renderTreeNode(key, val, depth, container, autoExpand);
});
```

---

## Task 7: Test All Features

- [ ] **Step 1: Load extension in Chrome**

- [ ] **Step 2: Test theme toggle**
- Toggle theme in popup
- Verify popup switches between light/dark
- Hover over AEM component, verify tooltip shows correct theme

- [ ] **Step 3: Test CRXDE encoding**
- Find component with special chars in path (spaces, brackets)
- Click CRXDE button
- Verify URL is properly encoded

- [ ] **Step 4: Test auto-scroll**
- Scroll AEM page so component is off-screen
- Hover over component
- Verify page scrolls to show component

- [ ] **Step 5: Test expanded JSON view**
- Click expand button on tooltip
- Verify full JSON tree is shown without depth limit
- Verify panel is wider

---

## Verification Commands

```bash
# No build step needed - Chrome Extension reload required
# Load unpacked extension: chrome://extensions → Load unpacked
```

---

## Notes

- Chrome storage persists across sessions
- Theme changes apply to both popup and tooltip
- CRXDE encoding handles: spaces, brackets, quotes, etc.
- Auto-scroll only triggers when component is not visible in viewport
