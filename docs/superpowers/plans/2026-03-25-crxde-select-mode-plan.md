# CRXDE Encoding Fix + Click-to-Select Mode Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix CRXDE path encoding to only encode special chars (not /), remove auto-scroll, implement click-to-select mode

**Tech Stack:** Chrome Extension (manifest v3), vanilla JS, CSS

---

## Task 1: Fix CRXDE Path Encoding (Selective)

### Files:
- Modify: `content.js:300-313`

- [ ] **Step 1: Create helper function for selective encoding**

Add at top of content.js (after state variables):

```javascript
function encodeCRXDEPath(path) {
  return path.replace(/([:\[\]\s])/g, (match) => {
    return encodeURIComponent(match);
  });
}
```

This encodes `:`, `[`, `]`, and spaces but keeps `/` intact.

- [ ] **Step 2: Update CRXDE button handler**

Replace the encodeURIComponent with the helper:

```javascript
document.getElementById('aemi-crxde').addEventListener('click', () => {
  const encodedPath = encodeCRXDEPath(currentPath);
  window.open(`${currentBaseUrl}/crx/de#${encodedPath}`, '_blank');
});
```

- [ ] **Step 3: Update Policy button handler**

```javascript
document.getElementById('aemi-policy-btn').addEventListener('click', () => {
  const policyPath = document.getElementById('aemi-policy-path').textContent;
  if (policyPath && policyPath !== '—') {
    const encodedPath = encodeCRXDEPath(policyPath);
    window.open(`${currentBaseUrl}/crx/de#${encodedPath}`, '_blank');
  }
});
```

---

## Task 2: Remove Auto-scroll

### Files:
- Modify: `content.js:320-337`

- [ ] **Step 1: Remove scrollIntoView from populateTooltip**

Remove these lines from populateTooltip:

```javascript
const rect = el.getBoundingClientRect();
const isVisible = rect.top >= 0 && rect.bottom <= window.innerHeight && 
                  rect.left >= 0 && rect.right <= window.innerWidth;
if (!isVisible) {
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
```

---

## Task 3: Implement Click-to-Select Mode

### Files:
- Modify: `content.js:69-94`

- [ ] **Step 1: Replace hover with click handler**

Replace `attachHoverListeners` function:

```javascript
function attachHoverListeners() {
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown);
}

function onClick(e) {
  if (!inspectorEnabled) return;
  
  const component = findAEMComponent(e.target);
  if (component) {
    e.preventDefault();
    e.stopPropagation();
    selectComponent(component);
  } else if (tooltip.contains(e.target)) {
    return;
  } else {
    deselectComponent();
  }
}

function selectComponent(el) {
  removeHighlights();
  highlightComponent(el);
  populateTooltip(el);
  
  isPinned = true;
  isExpanded = true;
  
  tooltip.classList.add('aemi--pinned');
  tooltip.classList.add('aemi--expanded');
  tooltip.classList.add('aemi--visible');
  
  document.getElementById('aemi-pin').style.opacity = '1';
  document.getElementById('aemi-expand').textContent = '⤡';
  document.getElementById('aemi-expand').title = 'Collapse';
}

function deselectComponent() {
  isPinned = false;
  isExpanded = false;
  tooltip.classList.remove('aemi--pinned');
  tooltip.classList.remove('aemi--expanded');
  tooltip.classList.remove('aemi--visible');
  removeHighlights();
}
```

- [ ] **Step 2: Update onKeyDown for click mode**

```javascript
function onKeyDown(e) {
  if (e.key === 'Escape') {
    deselectComponent();
  }
  if (e.altKey && e.shiftKey && e.key === 'I') {
    inspectorEnabled = !inspectorEnabled;
    chrome.runtime.sendMessage({ type: 'TOGGLE_INSPECTOR', enabled: inspectorEnabled });
    if (!inspectorEnabled) { 
      deselectComponent(); 
    }
  }
}
```

- [ ] **Step 3: Update ESC to deselect (in close button handler)**

Update the close button handler:

```javascript
document.getElementById('aemi-close').addEventListener('click', () => {
  deselectComponent();
});
```

---

## Task 4: Update Hover Handlers (Remove)

### Files:
- Modify: `content.js:75-94`

- [ ] **Step 1: Remove old hover handlers**

Remove or comment out `onMouseOver`, `onMouseOut` functions since we're using click now.

---

## Verification

```bash
# Reload extension in Chrome
# Test on AEM author page:
# 1. Click on a component - should pin and expand panel with full JSON
# 2. Click CRXDE button - path should be /content/.../jcr%3Acontent/...
# 3. Press ESC - should deselect and close panel
# 4. Click outside component - should deselect
```

---

## Notes

- encodeURIComponent encodes EVERYTHING including /
- encodeCRXDEPath only encodes special chars: : [ ] space
- Path `/content/.../jcr:content/...` → `/content/.../jcr%3Acontent/...`
- Click-to-select replaces hover behavior
- Panel auto-expands when component is selected
