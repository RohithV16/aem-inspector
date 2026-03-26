# AEM Component Inspector - Agent Guidelines

This is a Chrome Extension for inspecting AEM (Adobe Experience Manager) components on author pages.

## Superpowers Skills - Mandatory Usage

You MUST use the following Superpowers skills for the corresponding tasks. This is not optional.

| Task Type | Skill to Use | When to Invoke |
|-----------|--------------|----------------|
| Creating features, adding functionality, or modifying behavior | `brainstorming` | BEFORE any creative work |
| Fixing bugs, test failures, or unexpected behavior | `systematic-debugging` | BEFORE proposing fixes |
| Implementing any feature or bugfix | `test-driven-development` | BEFORE writing implementation code |
| Claiming work is complete, fixed, or passing | `verification-before-completion` | BEFORE committing or creating PRs |
| Completing tasks or implementing major features | `requesting-code-review` | BEFORE merging |
| Receiving code review feedback | `receiving-code-review` | BEFORE implementing suggestions |
| Multi-step task with written spec/requirements | `writing-plans` | BEFORE touching code |
| 2+ independent tasks without shared state | `dispatching-parallel-agents` | When tasks can run in parallel |
| Starting feature work needing isolation | `using-git-worktrees` | Before implementing plans |

## Project Structure

```
aem-inspector/
├── content.js      # Main content script - injected into AEM pages
├── background.js   # Service worker - handles messaging, caching, fetch
├── popup.html      # Extension popup UI
├── popup.js        # Popup JavaScript
├── tooltip.css     # All extension styling
├── manifest.json   # Extension manifest (MV3)
└── icons/          # Extension icons (16, 48, 128px)
```

## Commands

### Testing the Extension

1. **Load in Chrome**:
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `aem-inspector` directory

2. **Reload after changes**:
   - In `chrome://extensions/`, click the reload icon on the extension
   - Or refresh the AEM page (content script reloads)

3. **Test on AEM**:
   - Use local AEM at `localhost:4502` or `127.0.0.1:4502`
   - Use AEM pages at `*.aem.page` domains
   - Hover over components to see the inspector tooltip
   - Click to pin the sidebar

### Linting

No formal linter configured. Before committing, verify:
- JavaScript syntax is valid (`node --check content.js`)
- No console.log statements left in production code
- All referenced DOM elements exist in HTML

### Running a Single Test

There are no automated tests. Manual testing required:
1. Load extension in Chrome
2. Navigate to an AEM author page
3. Test hover, click, expand, pin functionality
4. Verify tree view and JSON fetching work correctly

## Code Style Guidelines

### General Principles

- **Vanilla JavaScript only** - No frameworks, no npm dependencies
- **ES6+ features** - Use const/let, arrow functions, template literals
- **IIFE wrapper** - All scripts must be wrapped in `(function() { 'use strict'; ... })();`
- **No build step** - All code must work as-is in Chrome

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Functions | camelCase, verb prefix | `findAEMComponent()`, `fetchLiveData()` |
| Constants | UPPER_SNAKE_CASE | `JCR_SKIP`, `AEM_ATTRS` |
| DOM IDs | kebab-case | `aemi-name`, `aemi-fetch-status` |
| CSS Classes | BEM-ish with prefix | `aemi-tree-toggle`, `aemi-tree-children` |
| State Variables | camelCase with prefix | `isPinned`, `currentPath`, `currentTheme` |

### Formatting

- **Indentation**: 2 spaces
- **Line length**: Soft limit 100 characters
- **Sections**: Use `// ── Title ──` comment blocks to organize code
- **Function spacing**: 1 blank line between functions
- **Object spacing**: 1 space after colon, no trailing commas

```javascript
// Good
function encodeCRXDEPath(path) {
  return path.replace(/([:\[\]\s])/g, (match) => {
    return encodeURIComponent(match);
  });
}

// Bad
function encodeCRXDEPath(path){
  return path.replace(/([:\[\]\s])/g,(match)=>{
    return encodeURIComponent(match);
  });
}
```

### Imports/Dependencies

None - vanilla JS only. Use Chrome APIs:
- `chrome.runtime.sendMessage()` for content→background communication
- `chrome.runtime.onMessage.addListener()` for receiving messages
- `chrome.storage.sync.get/set()` for persistent settings

### Error Handling

- **Always use strict mode**: `'use strict';` at top of IIFE
- **Null checks for DOM**: Check elements exist before accessing
- **Fetch errors**: Handle failures gracefully with user feedback
- **Message responses**: Always check `response` and `response.success`

```javascript
// Good
chrome.runtime.sendMessage({ type: 'FETCH_COMPONENT_DATA', path }, (response) => {
  if (!response || !response.success) {
    showError('Failed to fetch data');
    return;
  }
  // process response.data
});

// Bad
chrome.runtime.sendMessage({ type: 'FETCH_COMPONENT_DATA', path }, (response) => {
  const data = response.data; // Will throw if response is null
});
```

### DOM Element Access

- Use `document.getElementById()` for known elements
- Cache element references when accessed repeatedly
- Use optional chaining `?.` and null checks for dynamically created elements

```javascript
// Good
const pinBtn = document.getElementById('aemi-pin');
if (pinBtn) pinBtn.style.opacity = '1';

// Bad
document.getElementById('aemi-pin').style.opacity = '1'; // Will throw if element missing
```

### State Management

- Keep state in module-level variables (no global window properties)
- Use descriptive boolean prefixes: `isPinned`, `isExpanded`, `isResizing`
- Sync critical state to chrome.storage for persistence

### CSS Guidelines

- Use CSS custom properties for theming (see `tooltip.css`)
- Prefix all classes with `aemi-` to avoid conflicts
- Use dark theme as default
- Support light/dark via `data-theme` attribute on `:root`

### Chrome Extension Specific

- **Manifest V3**: Use service worker (background.js), not background pages
- **Host permissions**: Only what's needed (`*.adobeaemcloud.com`, `*.aem.page`, localhost)
- **Content script injection**: `run_at: document_idle` for late injection
- **Message passing**: Always return `true` for async message handlers

### AEM-Specific Patterns

1. **Component detection**: Check for `data-path`, `data-cq-data-path`, `data-cq-resource-type`
2. **CRXDE paths**: Only encode special chars (`:`, `[`, `]`, space), NOT forward slashes
3. **Path patterns**: Look for `/content/.../jcr:content/root` structure
4. **JSON endpoints**: Use `.infinity.json` for full content trees

### Code Review Checklist

Before submitting changes:
- [ ] Syntax valid (`node --check`)
- [ ] No console.log statements
- [ ] All DOM elements null-checked
- [ ] Error handling for all async operations
- [ ] Works on both light and dark themes
- [ ] Tested on actual AEM page

### Common Pitfalls

1. **Duplicate event listeners**: Don't add multiple listeners to same element
2. **Removed DOM references**: If you remove UI elements, remove corresponding JS code
3. **Path encoding**: Don't use `encodeURIComponent()` on full paths (breaks `/`)
4. **Memory leaks**: Avoid creating new event listeners in loops without cleanup
5. **Race conditions**: Check element existence before accessing in callbacks
