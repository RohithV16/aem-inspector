// content.js — AEM Component Inspector Content Script
// Injected into AEM Author pages to detect and inspect components

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  let inspectorEnabled = true;
  let tooltip = null;
  let hideTimer = null;
  let hoverTimer = null;
  let currentPath = '';
  let currentResourceType = '';
  let currentBaseUrl = '';
  let isPinned = false;
  let isSidebarMode = false;
  let sidebarSide = 'right';
  let currentTheme = 'dark';
  let dragPos = null;
  let isDragging = false;
  let toastContainer = null;
  let searchModal = null;
  let searchIndex = [];
  let isSearchOpen = false;
  let isOnboarded = false;
  let usageCounts = {};
  let lockStatusRequestId = 0;

  // Helper: Escape HTML entities to prevent XSS
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // AEM data attributes to look for
  const AEM_ATTRS = [
    'data-cq-data-path',
    'data-path',
    'data-cq-resource-type',
    'data-cq-component',
    'data-cq-drop-target'
  ];

  // Helper: Selective encoding for CRXDE paths (only encode special chars, not /)
  function encodeCRXDEPath(path) {
    return path.replace(/([:\[\]\s])/g, (match) => {
      return encodeURIComponent(match);
    });
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    currentBaseUrl = `${window.location.protocol}//${window.location.host}`;

    // Check if this is an AEM author page
    if (!isAEMAuthorPage()) return;

    // Load saved sidebar side from localStorage
    try {
      const savedSide = localStorage.getItem('aemi-sidebar-side');
      if (savedSide === 'left' || savedSide === 'right') {
        sidebarSide = savedSide;
      }
    } catch (e) {
      // localStorage may not be available in private browsing
    }

    // Load saved drag position
    try {
      const savedPos = localStorage.getItem('aemi-drag-pos');
      if (savedPos) {
        dragPos = JSON.parse(savedPos);
      }
    } catch (e) {
      dragPos = null;
    }

    // Check onboarding status
    try {
      isOnboarded = localStorage.getItem('aemi-onboarded') === 'true';
    } catch (e) {}

    // Load settings
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (response) => {
      if (response) {
        inspectorEnabled = response.enabled;
        currentTheme = response.theme || 'dark';
        document.documentElement.setAttribute('data-theme', currentTheme);
      }
      if (inspectorEnabled) activateInspector();
    });

    // Listen for toggle from popup
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'INSPECTOR_TOGGLED') {
        inspectorEnabled = message.enabled;
        if (!inspectorEnabled) {
          removeHighlights();
          hideTooltip();
        }
      }
      if (message.type === 'THEME_CHANGED') {
        currentTheme = message.theme;
        document.documentElement.setAttribute('data-theme', currentTheme);
      }
    });
  }

  function isAEMAuthorPage() {
    return (
      document.querySelector('[data-cq-data-path]') !== null ||
      document.querySelector('[data-path]') !== null ||
      document.querySelector('.cq-Overlay') !== null ||
      document.querySelector('#cq-editor') !== null ||
      window.location.pathname.includes('/editor.html') ||
      window.location.pathname.includes('/cf#')
    );
  }

  // ── Inspector Activation ───────────────────────────────────────────────────
  function activateInspector() {
    createToastContainer();
    createTooltip();
    createSearchModal();
    attachHoverListeners();
    buildSearchIndex();
    buildUsageCounts();
    observeDOM();

    if (!isOnboarded) {
      showOnboarding();
    }
  }

  function attachHoverListeners() {
    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mouseout', onMouseOut, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
  }

  // ── Toast Notifications ────────────────────────────────────────────────────
  function createToastContainer() {
    toastContainer = document.createElement('div');
    toastContainer.id = 'aemi-toast-container';
    toastContainer.setAttribute('data-aem-inspector', 'true');
    document.body.appendChild(toastContainer);
  }

  function showToast(message, type) {
    type = type || 'info';
    const toast = document.createElement('div');
    toast.className = `aemi-toast aemi-toast--${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
      toast.classList.add('aemi-toast--visible');
    });

    // Auto-dismiss after 2 seconds
    setTimeout(() => {
      toast.classList.remove('aemi-toast--visible');
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  // ── Component Search (⌘+K) ────────────────────────────────────────────────
  function createSearchModal() {
    searchModal = document.createElement('div');
    searchModal.id = 'aemi-search-modal';
    searchModal.setAttribute('data-aem-inspector', 'true');
    searchModal.innerHTML = `
      <div class="aemi-search-overlay"></div>
      <div class="aemi-search-box">
        <input type="text" class="aemi-search-input" id="aemi-search-input" placeholder="Search components..." autocomplete="off" />
        <div class="aemi-search-results" id="aemi-search-results"></div>
        <div class="aemi-search-hint">
          <span>↑↓ Navigate</span>
          <span>↵ Select</span>
          <span>Esc Close</span>
        </div>
      </div>
    `;
    searchModal.style.display = 'none';
    document.body.appendChild(searchModal);

    // Close on overlay click
    searchModal.querySelector('.aemi-search-overlay').addEventListener('click', closeSearch);

    // Search input handler
    const input = searchModal.querySelector('#aemi-search-input');
    input.addEventListener('input', () => {
      renderSearchResults(input.value);
    });

    // Keyboard navigation in search
    input.addEventListener('keydown', (e) => {
      const results = searchModal.querySelectorAll('.aemi-search-result');
      const active = searchModal.querySelector('.aemi-search-result--active');
      let index = Array.from(results).indexOf(active);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        index = Math.min(index + 1, results.length - 1);
        updateSearchSelection(results, index);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        index = Math.max(index - 1, 0);
        updateSearchSelection(results, index);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (active) active.click();
      } else if (e.key === 'Escape') {
        closeSearch();
      }
    });
  }

  function openSearch() {
    if (!searchModal) return;
    isSearchOpen = true;
    searchModal.classList.add('aemi--search-open');
    const input = searchModal.querySelector('#aemi-search-input');
    if (!input) return;
    input.value = '';
    renderSearchResults('');
    requestAnimationFrame(() => input.focus());
  }

  function closeSearch() {
    isSearchOpen = false;
    if (searchModal) searchModal.classList.remove('aemi--search-open');
  }

  function renderSearchResults(query) {
    const container = searchModal.querySelector('#aemi-search-results');
    container.innerHTML = '';
    const q = query.toLowerCase().trim();

    const filtered = q
      ? searchIndex.filter(item =>
          item.name.toLowerCase().includes(q) ||
          item.resourceType.toLowerCase().includes(q) ||
          item.path.toLowerCase().includes(q)
        )
      : searchIndex.slice(0, 50);

    if (filtered.length === 0) {
      container.innerHTML = '<div class="aemi-search-empty">No components found</div>';
      return;
    }

    filtered.slice(0, 50).forEach((item, i) => {
      const row = document.createElement('div');
      row.className = 'aemi-search-result' + (i === 0 ? ' aemi-search-result--active' : '');
      row.innerHTML = `
        <span class="aemi-search-result-name">${item.name}</span>
        <span class="aemi-search-result-type">${item.resourceType}</span>
      `;
      row.addEventListener('click', () => {
        closeSearch();
        removeHighlights();
        item.element.classList.add('aemi-highlighted');
        item.element.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Show tooltip
        highlightComponent(item.element);
        populateTooltip(item.element, false);
        positionTooltipAt(item.element);
        showTooltip();
      });
      container.appendChild(row);
    });
  }

  function updateSearchSelection(results, index) {
    results.forEach(r => r.classList.remove('aemi-search-result--active'));
    if (results[index]) {
      results[index].classList.add('aemi-search-result--active');
      results[index].scrollIntoView({ block: 'nearest' });
    }
  }

  function buildSearchIndex() {
    searchIndex = [];
    const elements = document.querySelectorAll('[data-cq-data-path], [data-path]');
    elements.forEach(el => {
      if (el.hasAttribute('data-aem-inspector')) return;
      const data = extractComponentData(el);
      if (data.path) {
        searchIndex.push({
          name: formatComponentName(data.componentName),
          resourceType: data.resourceType || 'unknown',
          path: data.path,
          element: el
        });
      }
    });
  }

  // ── Usage Counts ───────────────────────────────────────────────────────────
  function buildUsageCounts() {
    usageCounts = {};
    const elements = document.querySelectorAll('[data-cq-resource-type], [data-resource-type]');
    elements.forEach(el => {
      const rt = el.getAttribute('data-cq-resource-type') || el.getAttribute('data-resource-type') || '';
      if (rt) {
        usageCounts[rt] = (usageCounts[rt] || 0) + 1;
      }
    });
  }

  // ── Bulk Component Scan ────────────────────────────────────────────────────
  function openBulkScan() {
    const components = [];
    const elements = document.querySelectorAll('[data-cq-data-path], [data-path]');
    elements.forEach(el => {
      if (el.hasAttribute('data-aem-inspector')) return;
      const data = extractComponentData(el);
      if (data.path) {
        components.push({
          name: formatComponentName(data.componentName),
          resourceType: data.resourceType,
          path: data.path,
          usageCount: usageCounts[data.resourceType] || 0
        });
      }
    });

    const safeTitle = document.title.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>AEM Bulk Scan - ${safeTitle}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'JetBrains Mono', monospace; background: #0d0f14; color: #e2e8f0; padding: 24px; }
  h1 { font-size: 18px; color: #4f8ef7; margin-bottom: 16px; }
  .summary { font-size: 12px; color: #64748b; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { background: #111827; color: #4f8ef7; text-align: left; padding: 8px 12px; border-bottom: 2px solid #1e2230; cursor: pointer; }
  th:hover { color: #7cb9ff; }
  td { padding: 8px 12px; border-bottom: 1px solid #1e2230; }
  tr:hover td { background: rgba(79,142,247,0.05); }
  .path { color: #7cb9ff; }
  .type { color: #4f8ef7; }
  .name { color: #e2e8f0; }
  .badge { background: rgba(79,142,247,0.15); color: #4f8ef7; padding: 1px 6px; border-radius: 3px; font-size: 9px; }
  .export-btn { background: rgba(79,142,247,0.1); border: 1px solid rgba(79,142,247,0.35); color: #4f8ef7; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-family: inherit; font-size: 10px; margin-bottom: 16px; }
  .export-btn:hover { background: rgba(79,142,247,0.2); }
</style></head>
<body>
<h1>Component Scan - ${safeTitle}</h1>
<div class="summary">${components.length} components found</div>
<button class="export-btn" id="export-json">Export JSON</button>
<button class="export-btn" id="export-csv">Export CSV</button>
<table id="scan-table">
<thead><tr><th data-sort="name">Name</th><th data-sort="resourceType">Resource Type</th><th data-sort="path">Path</th><th data-sort="usageCount">Usage</th></tr></thead>
<tbody></tbody>
</table>
<script>
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function csvEsc(s) { s = String(s); return '"' + s.replace(/"/g, '""') + '"'; }
  var components = ${JSON.stringify(components)};
  function renderTable(sortKey, ascending) {
    components.sort(function(a, b) {
      var va = a[sortKey] || '', vb = b[sortKey] || '';
      if (typeof va === 'number' && typeof vb === 'number') return ascending ? va - vb : vb - va;
      return ascending ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });
    var tbody = document.querySelector('#scan-table tbody');
    tbody.innerHTML = '';
    components.forEach(function(c) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td class="name">' + esc(c.name) + '</td><td class="type">' + esc(c.resourceType) + '</td><td class="path">' + esc(c.path) + '</td><td><span class="badge">×' + esc(c.usageCount) + '</span></td>';
      tbody.appendChild(tr);
    });
  }
  renderTable('name', true);
  document.querySelectorAll('#scan-table th').forEach(function(th) {
    var asc = true;
    th.addEventListener('click', function() { renderTable(this.dataset.sort, asc); asc = !asc; });
  });
  document.getElementById('export-json').addEventListener('click', function() {
    var blob = new Blob([JSON.stringify(components, null, 2)], {type: 'application/json'});
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'components-scan.json'; a.click();
  });
  document.getElementById('export-csv').addEventListener('click', function() {
    var csv = 'Name,Resource Type,Path,Usage\\n';
    components.forEach(function(c) { csv += csvEsc(c.name) + ',' + csvEsc(c.resourceType) + ',' + csvEsc(c.path) + ',' + c.usageCount + '\\n'; });
    var blob = new Blob([csv], {type: 'text/csv'});
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'components-scan.csv'; a.click();
  });
</script></body></html>`;

    const blob = new Blob([html], { type: 'text/html' });
    window.open(URL.createObjectURL(blob), '_blank');
    showToast('Bulk scan opened in new tab', 'success');
  }

  // ── Onboarding ─────────────────────────────────────────────────────────────
  function showOnboarding() {
    const overlay = document.createElement('div');
    overlay.id = 'aemi-onboarding';
    overlay.setAttribute('data-aem-inspector', 'true');
    overlay.innerHTML = `
      <div class="aemi-onboarding-overlay"></div>
      <div class="aemi-onboarding-card">
        <div class="aemi-onboarding-icon">⬡</div>
        <h2 class="aemi-onboarding-title">Welcome to AEM Inspector</h2>
        <div class="aemi-onboarding-steps">
          <div class="aemi-onboarding-step">
            <span class="aemi-onboarding-step-num">1</span>
            <span>Hover over components to inspect</span>
          </div>
          <div class="aemi-onboarding-step">
            <span class="aemi-onboarding-step-num">2</span>
            <span>Click "Pin to Sidebar" for full details</span>
          </div>
          <div class="aemi-onboarding-step">
            <span class="aemi-onboarding-step-num">3</span>
            <span>Press ⌘+K to search all components</span>
          </div>
          <div class="aemi-onboarding-step">
            <span class="aemi-onboarding-step-num">4</span>
            <span>Alt+Shift+I to toggle inspector</span>
          </div>
        </div>
        <button class="aemi-onboarding-btn" id="aemi-onboarding-dismiss">Got it!</button>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#aemi-onboarding-dismiss').addEventListener('click', () => {
      overlay.remove();
      try { localStorage.setItem('aemi-onboarded', 'true'); } catch (e) {}
      isOnboarded = true;
    });
  }

  // ── Hover / Click ──────────────────────────────────────────────────────────
  function onMouseOver(e) {
    if (!inspectorEnabled || isSidebarMode) return;
    const component = findAEMComponent(e.target);
    if (component) {
      clearTimeout(hideTimer);
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => {
        highlightComponent(component);
        populateTooltip(component, false);
        positionTooltip(e);
        showTooltip();
      }, 30);
    }
  }

  function onMouseOut(e) {
    if (!inspectorEnabled || isSidebarMode) return;
    const component = findAEMComponent(e.target);
    if (component && !tooltip.contains(e.relatedTarget)) {
      scheduleHide();
      removeHighlight(component);
    }
  }

  function onClick(e) {
    if (!inspectorEnabled) return;

    const component = findAEMComponent(e.target);
    if (component) {
      e.preventDefault();
      e.stopPropagation();
      if (isSidebarMode) {
        removeHighlights();
        highlightComponent(component);
        populateTooltip(component, true);
      } else {
        removeHighlights();
        highlightComponent(component);
        populateTooltip(component, false);
        showTooltip();
      }
    } else if (tooltip.contains(e.target)) {
      return;
    } else if (!isSidebarMode) {
      hideTooltip();
      removeHighlights();
    }
  }

  // ── Sidebar Controls ──────────────────────────────────────────────────────
  function pinToSidebar() {
    const component = document.querySelector('.aemi-highlighted');
    if (!component) return;

    isSidebarMode = true;
    isPinned = true;

    populateTooltip(component, true);
    tooltip.classList.add('aemi--sidebar');
    tooltip.classList.add(`aemi--sidebar-${sidebarSide}`);
    tooltip.classList.add('aemi--visible');
    tooltip.classList.remove('aemi--pinned');

    updateSidebarToggleState();
    toggleSidebarButtons(true);
  }

  function unpinFromSidebar() {
    isSidebarMode = false;
    isPinned = false;

    tooltip.classList.remove('aemi--sidebar');
    tooltip.classList.remove('aemi--sidebar-left');
    tooltip.classList.remove('aemi--sidebar-right');
    tooltip.classList.remove('aemi--visible');
    tooltip.classList.remove('aemi--pinned');

    removeHighlights();
    toggleSidebarButtons(false);
  }

  function switchSidebarSide(side) {
    sidebarSide = side;
    try { localStorage.setItem('aemi-sidebar-side', sidebarSide); } catch (e) {}

    if (isSidebarMode) {
      tooltip.classList.remove('aemi--sidebar-left', 'aemi--sidebar-right');
      tooltip.classList.add(`aemi--sidebar-${sidebarSide}`);
    }

    updateSidebarToggleState();
  }

  function updateSidebarToggleState() {
    const leftBtn = document.getElementById('aemi-sidebar-left');
    const rightBtn = document.getElementById('aemi-sidebar-right');
    if (!leftBtn || !rightBtn) return;

    leftBtn.classList.toggle('aemi--active', sidebarSide === 'left');
    rightBtn.classList.toggle('aemi--active', sidebarSide === 'right');
  }

  function toggleSidebarButtons(show) {
    const leftBtn = document.getElementById('aemi-sidebar-left');
    const rightBtn = document.getElementById('aemi-sidebar-right');
    const pinBtn = document.getElementById('aemi-pin-sidebar');
    const unpinBtn = document.getElementById('aemi-unpin-sidebar');

    if (show) {
      if (leftBtn) leftBtn.classList.add('aemi--visible');
      if (rightBtn) rightBtn.classList.add('aemi--visible');
      if (unpinBtn) {
        unpinBtn.style.display = '';
        unpinBtn.classList.add('aemi--visible');
      }
      if (pinBtn) pinBtn.style.display = 'none';
    } else {
      if (leftBtn) leftBtn.classList.remove('aemi--visible');
      if (rightBtn) rightBtn.classList.remove('aemi--visible');
      if (unpinBtn) {
        unpinBtn.style.display = 'none';
        unpinBtn.classList.remove('aemi--visible');
      }
      if (pinBtn) pinBtn.style.display = '';
    }
  }

  function deselectComponent() {
    unpinFromSidebar();
  }

  function onKeyDown(e) {
    // ⌘+K / Ctrl+K for search (always allow closing, only open if enabled)
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      if (isSearchOpen) {
        closeSearch();
      } else if (inspectorEnabled) {
        openSearch();
      }
      return;
    }

    // Allow Escape to close search even when disabled
    if (e.key === 'Escape' && isSearchOpen) {
      closeSearch();
      return;
    }

    if (!inspectorEnabled) return;

    if (e.key === 'Escape') {
      if (isSidebarMode) {
        unpinFromSidebar();
      } else {
        hideTooltip();
        removeHighlights();
      }
    }
    if (e.altKey && e.shiftKey && e.key === 'I') {
      inspectorEnabled = !inspectorEnabled;
      chrome.runtime.sendMessage({ type: 'TOGGLE_INSPECTOR', enabled: inspectorEnabled });
      if (!inspectorEnabled) {
        unpinFromSidebar();
      }
    }
  }

  // ── Component Detection ────────────────────────────────────────────────────
  function findAEMComponent(el) {
    let current = el;
    while (current && current !== document.body) {
      if (hasAEMData(current)) return current;
      current = current.parentElement;
    }
    return null;
  }

  function hasAEMData(el) {
    return AEM_ATTRS.some(attr => el.hasAttribute && el.hasAttribute(attr));
  }

  function extractComponentData(el) {
    const path = el.getAttribute('data-cq-data-path') || el.getAttribute('data-path') || '';
    const resourceType = el.getAttribute('data-cq-resource-type') || el.getAttribute('data-resource-type') || '';

    let componentName = el.getAttribute('data-cq-component');
    if (!componentName) {
      componentName = el.getAttribute('title');
    }
    if (!componentName) {
      const ariaLabel = el.getAttribute('aria-label');
      componentName = ariaLabel ? ariaLabel.split(':')[0] : '';
    }
    if (!componentName) {
      componentName = resourceType.split('/').pop();
    }
    if (!componentName) {
      componentName = path.split('/').pop();
    }
    if (!componentName) {
      componentName = 'Unknown Component';
    }

    const templateMeta = document.querySelector('meta[name="template"]');
    const template = templateMeta ? templateMeta.content : '';
    const policyAttr = el.getAttribute('data-cq-policy') || '';

    const props = {};
    Array.from(el.attributes).forEach(attr => {
      if (attr.name.startsWith('data-') &&
          !attr.name.startsWith('data-cq-') &&
          !attr.name.startsWith('data-path')) {
        const key = attr.name.replace('data-', '');
        props[key] = attr.value;
      }
    });

    return { path, resourceType, componentName, template, policyAttr, props };
  }

  // ── Tooltip UI ─────────────────────────────────────────────────────────────
  function createTooltip() {
    tooltip = document.createElement('div');
    tooltip.id = 'aem-inspector-tooltip';
    tooltip.setAttribute('data-aem-inspector', 'true');

    tooltip.innerHTML = `
      <div class="aemi-resize-handle" id="aemi-resize-handle"></div>
      <div class="aemi-header" id="aemi-header">
        <div class="aemi-title">
          <div class="aemi-icon">⬡</div>
          <div class="aemi-title-text">
            <span class="aemi-name" id="aemi-name">Component</span>
            <div class="aemi-breadcrumb" id="aemi-breadcrumb"></div>
          </div>
        </div>
        <div class="aemi-header-actions">
          <button class="aemi-sidebar-toggle" id="aemi-sidebar-left" title="Dock to left" style="display:none">◀</button>
          <button class="aemi-sidebar-toggle" id="aemi-sidebar-right" title="Dock to right" style="display:none">▶</button>
          <button class="aemi-close" id="aemi-close" title="Close (ESC)">✕</button>
        </div>
      </div>

      <div class="aemi-body">
        <div class="aemi-section aemi-section--collapsible" id="aemi-section-resource">
          <div class="aemi-section-header" data-collapsible="aemi-section-resource">
            <div class="aemi-section-label">Resource Type <span class="aemi-usage-badge" id="aemi-usage-badge"></span></div>
            <span class="aemi-section-arrow">▸</span>
          </div>
          <div class="aemi-section-content">
            <div class="aemi-resource" id="aemi-resource"></div>
            <div class="aemi-lock-status" id="aemi-lock-status"></div>
          </div>
        </div>

        <div class="aemi-section aemi-section--collapsible" id="aemi-section-path">
          <div class="aemi-section-header" data-collapsible="aemi-section-path">
            <div class="aemi-section-label">JCR Path <a class="aemi-crxde-link" id="aemi-path-crxde" title="Open in CRXDE" target="_blank">📂</a></div>
            <span class="aemi-section-arrow">▸</span>
          </div>
          <div class="aemi-section-content">
            <div class="aemi-path-val" id="aemi-path"></div>
          </div>
        </div>

        <div class="aemi-section aemi-section--collapsible aemi-section--expanded" id="aemi-props-section">
          <div class="aemi-section-header" data-collapsible="aemi-props-section">
            <div class="aemi-section-label">Properties</div>
            <span class="aemi-section-arrow open">▸</span>
          </div>
          <div class="aemi-section-content">
            <div id="aemi-props"></div>
            <div class="aemi-fetch-status" id="aemi-fetch-status">⟳ Fetching live data...</div>
          </div>
        </div>
      </div>

      <div class="aemi-actions">
        <button class="aemi-btn aemi-btn--pin" id="aemi-pin-sidebar">🏓 Pin to Sidebar</button>
        <button class="aemi-btn aemi-btn--unpin" id="aemi-unpin-sidebar" style="display:none">✕ Unpin</button>
        <button class="aemi-btn aemi-btn--primary" id="aemi-copy">📋 Copy Path</button>
        <button class="aemi-btn" id="aemi-copy-type">🏷️ Copy Type</button>
        <button class="aemi-btn" id="aemi-crxde">📂 CRXDE</button>
        <button class="aemi-btn" id="aemi-json">{ } JSON</button>
        <button class="aemi-btn" id="aemi-search-btn">🔍 Search</button>
        <button class="aemi-btn" id="aemi-scan-btn">📊 Scan All</button>
      </div>

      <div class="aemi-footer">
        <span>AEM Inspector</span>
        <span>⌘+K Search · Alt+Shift+I Toggle</span>
      </div>
    `;

    document.body.appendChild(tooltip);

    // ── Button Listeners ─────────────────────────────────────────────────────
    const closeBtn = document.getElementById('aemi-close');
    if (closeBtn) closeBtn.addEventListener('click', () => {
      if (isSidebarMode) unpinFromSidebar();
      else { hideTooltip(); removeHighlights(); }
    });

    const leftBtn = document.getElementById('aemi-sidebar-left');
    if (leftBtn) leftBtn.addEventListener('click', () => {
      if (sidebarSide !== 'left') switchSidebarSide('left');
    });

    const rightBtn = document.getElementById('aemi-sidebar-right');
    if (rightBtn) rightBtn.addEventListener('click', () => {
      if (sidebarSide !== 'right') switchSidebarSide('right');
    });

    // ── Collapsible Sections ─────────────────────────────────────────────────
    tooltip.querySelectorAll('.aemi-section-header[data-collapsible]').forEach(header => {
      header.addEventListener('click', () => {
        const sectionId = header.getAttribute('data-collapsible');
        const section = document.getElementById(sectionId);
        if (section) {
          const isExpanded = section.classList.toggle('aemi-section--expanded');
          const arrow = header.querySelector('.aemi-section-arrow');
          if (arrow) arrow.classList.toggle('open', isExpanded);
        }
      });
    });

    // ── Drag on Header ───────────────────────────────────────────────────────
    const header = document.getElementById('aemi-header');
    let dragStartX = 0, dragStartY = 0, dragOffsetX = 0, dragOffsetY = 0;

    if (header) {
      header.addEventListener('mousedown', (e) => {
        if (isSidebarMode) return;
        if (e.target.closest('button')) return;
        isDragging = true;
        dragStartX = tooltip.offsetLeft;
        dragStartY = tooltip.offsetTop;
        dragOffsetX = e.clientX;
        dragOffsetY = e.clientY;
        tooltip.style.transition = 'none';
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
        e.preventDefault();
      });
    }

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const newLeft = dragStartX + (e.clientX - dragOffsetX);
      const newTop = dragStartY + (e.clientY - dragOffsetY);
      const maxLeft = window.innerWidth - tooltip.offsetWidth;
      const maxTop = window.innerHeight - tooltip.offsetHeight;
      tooltip.style.left = Math.max(0, Math.min(maxLeft, newLeft)) + 'px';
      tooltip.style.top = Math.max(0, Math.min(maxTop, newTop)) + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        tooltip.style.transition = '';
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        dragPos = { left: tooltip.offsetLeft, top: tooltip.offsetTop };
        try { localStorage.setItem('aemi-drag-pos', JSON.stringify(dragPos)); } catch (e) {}
      }
    });

    // ── Action Buttons ───────────────────────────────────────────────────────
    const pinSidebarBtn = document.getElementById('aemi-pin-sidebar');
    if (pinSidebarBtn) pinSidebarBtn.addEventListener('click', () => pinToSidebar());

    const unpinSidebarBtn = document.getElementById('aemi-unpin-sidebar');
    if (unpinSidebarBtn) unpinSidebarBtn.addEventListener('click', () => unpinFromSidebar());

    const copyBtn = document.getElementById('aemi-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(currentPath).then(() => {
          showToast('Path copied to clipboard', 'success');
        });
      });
    }

    const copyTypeBtn = document.getElementById('aemi-copy-type');
    if (copyTypeBtn) {
      copyTypeBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(currentResourceType).then(() => {
          showToast('Resource type copied', 'success');
        });
      });
    }

    const crxdeLink = document.getElementById('aemi-path-crxde');
    if (crxdeLink) {
      crxdeLink.addEventListener('click', (e) => {
        e.preventDefault();
        const encodedPath = encodeCRXDEPath(currentPath);
        window.open(`${currentBaseUrl}/crx/de#${encodedPath}`, '_blank');
      });
    }

    const crxdeBtn = document.getElementById('aemi-crxde');
    if (crxdeBtn) {
      crxdeBtn.addEventListener('click', () => {
        const encodedPath = encodeCRXDEPath(currentPath);
        window.open(`${currentBaseUrl}/crx/de#${encodedPath}`, '_blank');
      });
    }

    const jsonBtn = document.getElementById('aemi-json');
    if (jsonBtn) {
      jsonBtn.addEventListener('click', () => {
        window.open(`${currentBaseUrl}${currentPath}.infinity.json`, '_blank');
      });
    }

    const searchBtn = document.getElementById('aemi-search-btn');
    if (searchBtn) searchBtn.addEventListener('click', () => openSearch());

    const scanBtn = document.getElementById('aemi-scan-btn');
    if (scanBtn) scanBtn.addEventListener('click', () => openBulkScan());

    // Keep tooltip open on hover
    tooltip.addEventListener('mouseenter', () => {
      if (!isSidebarMode) clearTimeout(hideTimer);
    });
    tooltip.addEventListener('mouseleave', () => {
      if (!isSidebarMode && !isPinned) scheduleHide();
    });
  }

  // ── Breadcrumb ─────────────────────────────────────────────────────────────
  function renderBreadcrumb(path) {
    const container = document.getElementById('aemi-breadcrumb');
    if (!container) return;
    container.innerHTML = '';

    const parts = path.split('/').filter(Boolean);
    if (parts.length <= 1) return;

    parts.forEach((part, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'aemi-breadcrumb-sep';
        sep.textContent = ' › ';
        container.appendChild(sep);
      }

      const seg = document.createElement('span');
      seg.className = 'aemi-breadcrumb-seg';
      seg.textContent = part;
      seg.title = parts.slice(0, i + 1).join('/');

      // Click to scroll to parent component
      seg.addEventListener('click', () => {
        const fullPath = '/' + parts.slice(0, i + 1).join('/');
        const el = document.querySelector(`[data-cq-data-path="${fullPath}"], [data-path="${fullPath}"]`);
        if (el) {
          removeHighlights();
          el.classList.add('aemi-highlighted');
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });

      container.appendChild(seg);
    });
  }

  // ── Populate Tooltip ──────────────────────────────────────────────────────
  function populateTooltip(el, showFullJson) {
    const data = extractComponentData(el);
    currentPath = data.path;
    currentResourceType = data.resourceType;

    const nameEl = document.getElementById('aemi-name');
    const resourceEl = document.getElementById('aemi-resource');
    const pathEl = document.getElementById('aemi-path');
    const usageBadge = document.getElementById('aemi-usage-badge');

    if (nameEl) nameEl.textContent = formatComponentName(data.componentName);
    if (resourceEl) resourceEl.textContent = data.resourceType || '—';
    if (pathEl) pathEl.textContent = data.path || '—';

    // Usage count badge
    if (usageBadge) {
      const count = usageCounts[data.resourceType] || 0;
      if (count > 1) {
        usageBadge.textContent = `×${count}`;
        usageBadge.style.display = '';
      } else {
        usageBadge.style.display = 'none';
      }
    }

    // Breadcrumb
    renderBreadcrumb(data.path);

    // Lock status
    fetchLockStatus(data.path);

    if (showFullJson) {
      fetchLiveData(data.path);
    } else {
      renderProps(data.props);
      const fetchStatus = document.getElementById('aemi-fetch-status');
      if (fetchStatus) fetchStatus.style.display = 'none';
    }
  }

  // ── Lock Status ────────────────────────────────────────────────────────────
  function fetchLockStatus(path) {
    const statusEl = document.getElementById('aemi-lock-status');
    if (!statusEl) return;
    statusEl.style.display = 'none';

    lockStatusRequestId++;
    const requestId = lockStatusRequestId;

    // Fetch jcr:content for lock info
    const contentPath = path.split('/').slice(0, -1).join('/') + '/jcr:content';
    chrome.runtime.sendMessage(
      { type: 'FETCH_COMPONENT_DATA', path: contentPath, baseUrl: currentBaseUrl },
      (response) => {
        if (requestId !== lockStatusRequestId) return;
        if (!response || !response.success) return;
        const data = response.data;
        if (data.properties) {
          const lockOwner = data.properties['jcr:lockOwner'];
          const lastModified = data.properties['cq:lastModified'];
          const lastModifiedBy = data.properties['cq:lastModifiedBy'];

          let statusText = '';
          if (lockOwner) {
            statusText = `🔒 Locked by ${lockOwner}`;
            statusEl.className = 'aemi-lock-status aemi-lock-status--locked';
          } else if (lastModifiedBy) {
            statusText = `Modified by ${lastModifiedBy}`;
            statusEl.className = 'aemi-lock-status';
          }

          if (statusText) {
            statusEl.textContent = statusText;
            statusEl.style.display = 'block';
          }
        }
      }
    );
  }

  // ── Render Props ───────────────────────────────────────────────────────────
  function renderProps(props) {
    const container = document.getElementById('aemi-props');
    if (!container) return;

    container.innerHTML = '';
    const entries = Object.entries(props).slice(0, 5);

    if (entries.length === 0) {
      container.innerHTML = '<div class="aemi-empty">No extra attributes found</div>';
      return;
    }

    entries.forEach(([key, val]) => {
      const row = document.createElement('div');
      row.className = 'aemi-prop-row';
      const valClass = val.startsWith('/') ? 'aemi-val--path' :
                       val === 'true' ? 'aemi-val--green' :
                       val === 'false' ? 'aemi-val--yellow' : '';
      row.innerHTML = `<span class="aemi-key">${esc(key)}</span><span class="aemi-val aemi-val--copyable ${valClass}" data-copy-value="${esc(val)}">${esc(val)}</span>`;
      container.appendChild(row);
    });

    // Attach click-to-copy on values
    attachCopyHandlers(container);
  }

  // ── Quick-Copy Handler ─────────────────────────────────────────────────────
  function attachCopyHandlers(container) {
    container.querySelectorAll('.aemi-val--copyable').forEach(el => {
      el.style.cursor = 'pointer';
      el.title = 'Click to copy';
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const value = el.getAttribute('data-copy-value') || el.textContent;
        navigator.clipboard.writeText(value).then(() => {
          showToast('Copied: ' + (value.length > 30 ? value.substring(0, 27) + '...' : value), 'success');
        });
      });
    });
  }

  // ── Tree View ──────────────────────────────────────────────────────────────
  const JCR_SKIP = ['jcr:primaryType', 'jcr:mixinTypes', 'jcr:uuid', 'jcr:created', 'jcr:createdBy'];

  function renderObjectAsTree(container, obj, depth) {
    if (!obj || typeof obj !== 'object') return;

    const entries = Object.entries(obj).filter(([k]) => !JCR_SKIP.includes(k));
    const primitives = entries.filter(([, v]) => v === null || typeof v !== 'object');
    const nested = entries.filter(([, v]) => v !== null && typeof v === 'object');

    primitives.forEach(([key, val]) => {
      renderTreeNode(key, val, depth, container);
    });

    if (primitives.length > 0 && nested.length > 0) {
      const sep = document.createElement('div');
      sep.className = 'aemi-tree-separator';
      container.appendChild(sep);
    }

    nested.forEach(([key, val]) => {
      const autoExpand = depth === 0;
      renderTreeNode(key, val, depth, container, autoExpand);
    });
  }

  function buildPreview(value) {
    const keys = Object.keys(value).filter(k => !JCR_SKIP.includes(k));
    const previewKeys = keys.slice(0, 3);
    const parts = previewKeys.map(k => {
      const v = value[k];
      if (v === null || v === undefined) return `${k}: —`;
      if (typeof v === 'object') return `${k}: {...}`;
      const s = String(v);
      const t = s.length > 18 ? s.substring(0, 15) + '...' : s;
      return `${k}: ${t}`;
    });
    if (keys.length > 3) parts.push(`+${keys.length - 3} more`);
    return parts.join(' · ');
  }

  function renderTreeNode(key, value, depth, container, autoExpand) {
    const maxDepth = isSidebarMode ? 10 : 2;

    if (depth > maxDepth) {
      const link = document.createElement('div');
      link.className = 'aemi-prop-row aemi-tree-deep-link';
      const spanKey = document.createElement('span');
      spanKey.className = 'aemi-key';
      spanKey.textContent = key;
      const spanVal = document.createElement('span');
      spanVal.className = 'aemi-val aemi-val--path';
      spanVal.textContent = '{ } Open in JSON';
      spanVal.style.cursor = 'pointer';
      spanVal.addEventListener('click', () => {
        window.open(`${currentBaseUrl}${currentPath}.infinity.json`, '_blank');
      });
      link.appendChild(spanKey);
      link.appendChild(spanVal);
      container.appendChild(link);
      return;
    }

    const isObject = value !== null && typeof value === 'object';
    const isArray = Array.isArray(value);

    if (!isObject) {
      const row = document.createElement('div');
      row.className = 'aemi-prop-row';
      const strVal = value === null ? '—' : String(value);
      const truncated = strVal.length > 50 ? strVal.substring(0, 47) + '...' : strVal;
      const valClass = strVal.startsWith('/') ? 'aemi-val--path' :
                       strVal === 'true' ? 'aemi-val--green' :
                       strVal === 'false' ? 'aemi-val--yellow' : '';
      const titleAttr = strVal.length > 50 ? ` title="${esc(strVal)}"` : '';
      row.innerHTML = `<span class="aemi-key">${esc(key)}</span><span class="aemi-val aemi-val--copyable ${valClass}" data-copy-value="${esc(strVal)}"${titleAttr}>${esc(truncated)}</span>`;
      container.appendChild(row);
      return;
    }

    const childKeys = Object.keys(value).filter(k => !JCR_SKIP.includes(k));
    const childCount = childKeys.length;
    const typeLabel = isArray ? 'item' : 'child';
    const badgeClass = isArray ? 'aemi-tree-badge aemi-tree-badge--array' : 'aemi-tree-badge';
    const preview = childCount > 0 ? buildPreview(value) : 'empty';

    const toggle = document.createElement('div');
    toggle.className = 'aemi-tree-toggle';
    if (depth > 0) toggle.classList.add(`aemi-tree-depth-${depth}`);
    toggle.innerHTML = `
      <span class="aemi-tree-arrow">▸</span>
      <span class="aemi-tree-key" data-path-key="${esc(key)}">${esc(key)}</span>
      <span class="${badgeClass}">${childCount} ${childCount === 1 ? typeLabel : typeLabel + 's'}</span>
    `;

    const keyEl = toggle.querySelector('.aemi-tree-key');
    keyEl.style.cursor = 'pointer';
    keyEl.title = 'Click to scroll to component';

    function findAndScrollToComponent() {
      const fullPath = currentPath + '/' + key;
      let el = null;
      const elements = document.querySelectorAll('[data-path], [data-cq-data-path]');

      for (const elem of elements) {
        const elemPath = elem.getAttribute('data-path') || elem.getAttribute('data-cq-data-path');
        if (elemPath === fullPath) { el = elem; break; }
      }
      if (!el) {
        const altPath = fullPath.replace('/jcr:content/', '/jcr:content/root/');
        for (const elem of elements) {
          const elemPath = elem.getAttribute('data-path') || elem.getAttribute('data-cq-data-path');
          if (elemPath === altPath) { el = elem; break; }
        }
      }
      if (!el) {
        for (const elem of elements) {
          const elemPath = elem.getAttribute('data-path') || elem.getAttribute('data-cq-data-path');
          if (elemPath && elemPath.includes(key)) { el = elem; break; }
        }
      }
      if (!el && key.includes('_')) {
        const baseKey = key.split('_')[0];
        for (const elem of elements) {
          const elemPath = elem.getAttribute('data-path') || elem.getAttribute('data-cq-data-path');
          if (elemPath && elemPath.includes(baseKey)) { el = elem; break; }
        }
      }

      if (el) {
        removeHighlights();
        el.classList.add('aemi-highlighted');
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    keyEl.addEventListener('click', (e) => {
      e.stopPropagation();
      findAndScrollToComponent();
    });

    const arrowEl = toggle.querySelector('.aemi-tree-arrow');
    arrowEl.title = 'Click to expand, Shift+Click to scroll';
    arrowEl.addEventListener('click', (e) => {
      if (e.shiftKey) {
        e.stopPropagation();
        findAndScrollToComponent();
      }
    });

    const previewEl = document.createElement('div');
    previewEl.className = 'aemi-tree-preview';
    if (depth > 0) previewEl.classList.add(`aemi-tree-depth-${depth}`);
    previewEl.textContent = preview;

    const childContainer = document.createElement('div');
    childContainer.className = 'aemi-tree-children';

    let rendered = false;
    function expandNode() {
      if (!rendered) {
        rendered = true;
        childKeys.forEach((ck, i) => {
          const childVal = isArray ? value[i] : value[ck];
          renderTreeNode(isArray ? `[${i}]` : ck, childVal, depth + 1, childContainer);
        });
      }
    }

    toggle.addEventListener('click', () => {
      const isOpen = toggle.classList.toggle('aemi-tree-open');
      toggle.querySelector('.aemi-tree-arrow').classList.toggle('open', isOpen);
      childContainer.classList.toggle('open', isOpen);
      previewEl.classList.toggle('aemi-tree-preview--hidden', isOpen);
      expandNode();
    });

    container.appendChild(toggle);
    container.appendChild(previewEl);
    container.appendChild(childContainer);

    if (autoExpand && childCount > 0) {
      toggle.classList.add('aemi-tree-open');
      toggle.querySelector('.aemi-tree-arrow').classList.add('open');
      childContainer.classList.add('open');
      previewEl.classList.add('aemi-tree-preview--hidden');
      expandNode();
    }
  }

  // ── Fetch Live Data ────────────────────────────────────────────────────────
  function fetchLiveData(path) {
    const status = document.getElementById('aemi-fetch-status');
    const container = document.getElementById('aemi-props');

    if (!path) {
      if (container) container.innerHTML = '<div class="aemi-empty">No path available</div>';
      return;
    }

    if (status) {
      status.style.display = 'block';
      status.textContent = '⟳ Fetching live data...';
    }

    chrome.runtime.sendMessage(
      { type: 'FETCH_COMPONENT_DATA', path, baseUrl: currentBaseUrl },
      (response) => {
        if (status) status.style.display = 'none';

        if (!response || !response.success) {
          if (container) container.innerHTML = '<div class="aemi-empty">Unable to fetch data</div>';
          return;
        }

        const liveData = response.data;

        if (liveData.properties && container) {
          container.innerHTML = '';
          const props = liveData.properties;
          const allKeys = Object.keys(props).filter(k => !JCR_SKIP.includes(k));
          const objCount = allKeys.filter(k => props[k] !== null && typeof props[k] === 'object').length;
          const primCount = allKeys.length - objCount;
          if (allKeys.length > 0) {
            const summary = document.createElement('div');
            summary.className = 'aemi-tree-summary';
            summary.textContent = `${primCount} properties · ${objCount} child nodes`;
            container.appendChild(summary);
          }

          renderObjectAsTree(container, liveData.properties, 0);
          attachCopyHandlers(container);

          if (container.children.length <= 1 && allKeys.length > 0) {
            allKeys.forEach(key => {
              const val = props[key];
              if (val !== null && typeof val === 'object') return;
              const row = document.createElement('div');
              row.className = 'aemi-prop-row';
              const strVal = val === null ? '—' : String(val);
              row.innerHTML = `<span class="aemi-key">${esc(key)}</span><span class="aemi-val aemi-val--copyable" data-copy-value="${esc(strVal)}">${esc(strVal)}</span>`;
              container.appendChild(row);
            });
          }
        } else if (container) {
          container.innerHTML = '<div class="aemi-empty">No properties found</div>';
        }
      }
    );
  }

  function formatComponentName(name) {
    return name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  // ── Tooltip Positioning ────────────────────────────────────────────────────
  function positionTooltip(e) {
    const OFFSET = 16;
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const TIP_W = tooltip.offsetWidth || 340;
    const TIP_H = tooltip.offsetHeight || 500;

    if (dragPos && dragPos.left !== undefined && dragPos.top !== undefined) {
      tooltip.style.left = dragPos.left + 'px';
      tooltip.style.top = dragPos.top + 'px';
      return;
    }

    let left = e.clientX + OFFSET;
    let top = e.clientY + OFFSET;
    if (left + TIP_W > winW - 12) left = e.clientX - TIP_W - OFFSET;
    if (top + TIP_H > winH - 12) top = e.clientY - TIP_H - OFFSET;
    if (left < 8) left = 8;
    if (top < 8) top = 8;

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function positionTooltipAt(el) {
    const rect = el.getBoundingClientRect();
    const OFFSET = 16;
    let left = rect.right + OFFSET;
    let top = rect.top;
    const TIP_W = tooltip.offsetWidth || 340;

    if (left + TIP_W > window.innerWidth - 12) {
      left = rect.left - TIP_W - OFFSET;
    }
    if (left < 8) left = 8;
    if (top < 8) top = 8;

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function showTooltip() {
    tooltip.classList.add('aemi--visible');
  }

  function hideTooltip() {
    if (!isSidebarMode) tooltip.classList.remove('aemi--visible');
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideTooltip, 250);
  }

  // ── Highlight ──────────────────────────────────────────────────────────────
  function highlightComponent(el) {
    removeHighlights();
    el.classList.add('aemi-highlighted');
  }

  function removeHighlight(el) {
    el && el.classList.remove('aemi-highlighted');
  }

  function removeHighlights() {
    document.querySelectorAll('.aemi-highlighted').forEach(el => {
      el.classList.remove('aemi-highlighted');
    });
  }

  // ── DOM Observer ───────────────────────────────────────────────────────────
  let rebuildTimer = null;
  function observeDOM() {
    const observer = new MutationObserver(() => {
      clearTimeout(rebuildTimer);
      rebuildTimer = setTimeout(() => {
        buildSearchIndex();
        buildUsageCounts();
      }, 1000);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ── Start ──────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
