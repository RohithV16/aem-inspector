// content.js — AEM Component Inspector Content Script
// Injected into AEM Author pages to detect and inspect components

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  let inspectorEnabled = true;
  let tooltip = null;
  let hideTimer = null;
  let currentPath = '';
  let currentBaseUrl = '';
  let isPinned = false;

  // AEM data attributes to look for
  const AEM_ATTRS = [
    'data-cq-data-path',
    'data-path',
    'data-cq-resource-type',
    'data-cq-component',
    'data-cq-drop-target'
  ];

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    currentBaseUrl = `${window.location.protocol}//${window.location.host}`;

    // Check if this is an AEM author page
    if (!isAEMAuthorPage()) return;

    // Load settings
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (response) => {
      if (response) inspectorEnabled = response.enabled;
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
    });
  }

  function isAEMAuthorPage() {
    // Check for AEM author indicators
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
    createTooltip();
    attachHoverListeners();
    observeDOM(); // Watch for dynamically added components
  }

  function attachHoverListeners() {
    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mouseout', onMouseOut, true);
    document.addEventListener('keydown', onKeyDown);
  }

  function onMouseOver(e) {
    if (!inspectorEnabled || isPinned) return;
    const component = findAEMComponent(e.target);
    if (component) {
      clearTimeout(hideTimer);
      highlightComponent(component);
      populateTooltip(component);
      positionTooltip(e);
      showTooltip();
    }
  }

  function onMouseOut(e) {
    if (!inspectorEnabled || isPinned) return;
    const component = findAEMComponent(e.target);
    if (component && !tooltip.contains(e.relatedTarget)) {
      scheduleHide();
      removeHighlight(component);
    }
  }

  function onKeyDown(e) {
    // ESC to close / unpin
    if (e.key === 'Escape') {
      isPinned = false;
      hideTooltip();
      removeHighlights();
    }
    // Alt+Shift+I to toggle
    if (e.altKey && e.shiftKey && e.key === 'I') {
      inspectorEnabled = !inspectorEnabled;
      chrome.runtime.sendMessage({ type: 'TOGGLE_INSPECTOR', enabled: inspectorEnabled });
      if (!inspectorEnabled) { hideTooltip(); removeHighlights(); }
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
    const resourceType = el.getAttribute('data-cq-resource-type') || '';
    const componentName = el.getAttribute('data-cq-component') ||
                          resourceType.split('/').pop() ||
                          'Unknown Component';

    // Try to get template from page properties
    const templateMeta = document.querySelector('meta[name="template"]');
    const template = templateMeta ? templateMeta.content : '';

    // Parse policy path from data or infer it
    const policyAttr = el.getAttribute('data-cq-policy') || '';

    // Collect all data-* attributes as props
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
      <div class="aemi-header">
        <div class="aemi-title">
          <div class="aemi-icon">⬡</div>
          <span class="aemi-name" id="aemi-name">Component</span>
        </div>
        <div class="aemi-header-actions">
          <button class="aemi-pin" id="aemi-pin" title="Pin tooltip">📌</button>
          <button class="aemi-close" id="aemi-close" title="Close (ESC)">✕</button>
        </div>
      </div>

      <div class="aemi-body">
        <div class="aemi-section">
          <div class="aemi-section-label">Resource Type</div>
          <div class="aemi-resource" id="aemi-resource"></div>
        </div>

        <div class="aemi-section">
          <div class="aemi-section-label">JCR Path</div>
          <div class="aemi-path-val" id="aemi-path"></div>
        </div>

        <div class="aemi-section" id="aemi-props-section">
          <div class="aemi-section-label">Properties</div>
          <div id="aemi-props"></div>
          <div class="aemi-fetch-status" id="aemi-fetch-status">⟳ Fetching live data...</div>
        </div>

        <div class="aemi-section" id="aemi-policy-section">
          <div class="aemi-section-label">Policy</div>
          <div class="aemi-prop-row">
            <span class="aemi-key">policyPath</span>
            <span class="aemi-val aemi-val--path" id="aemi-policy-path">—</span>
          </div>
        </div>

        <div class="aemi-section">
          <div class="aemi-section-label">Editable Config</div>
          <div class="aemi-prop-row">
            <span class="aemi-key">template</span>
            <span class="aemi-val aemi-val--path" id="aemi-template">—</span>
          </div>
          <div class="aemi-prop-row">
            <span class="aemi-key">editMode</span>
            <span class="aemi-val aemi-val--green" id="aemi-editmode">EDIT</span>
          </div>
        </div>
      </div>

      <div class="aemi-actions">
        <button class="aemi-btn aemi-btn--primary" id="aemi-copy">📋 Copy Path</button>
        <button class="aemi-btn" id="aemi-crxde">📂 CRXDE</button>
        <button class="aemi-btn" id="aemi-policy-btn">🎨 Policy</button>
        <button class="aemi-btn" id="aemi-json">{ } JSON</button>
      </div>

      <div class="aemi-footer">
        <span>AEM Inspector</span>
        <span>Alt+Shift+I to toggle</span>
      </div>
    `;

    document.body.appendChild(tooltip);

    // Button listeners
    document.getElementById('aemi-close').addEventListener('click', () => {
      isPinned = false;
      hideTooltip();
      removeHighlights();
    });

    document.getElementById('aemi-pin').addEventListener('click', () => {
      isPinned = !isPinned;
      document.getElementById('aemi-pin').style.opacity = isPinned ? '1' : '0.5';
      tooltip.classList.toggle('aemi--pinned', isPinned);
    });

    document.getElementById('aemi-copy').addEventListener('click', () => {
      navigator.clipboard.writeText(currentPath).then(() => {
        showCopyFeedback('aemi-copy', '✓ Copied!');
      });
    });

    document.getElementById('aemi-crxde').addEventListener('click', () => {
      window.open(`${currentBaseUrl}/crx/de#${currentPath}`, '_blank');
    });

    document.getElementById('aemi-json').addEventListener('click', () => {
      window.open(`${currentBaseUrl}${currentPath}.infinity.json`, '_blank');
    });

    document.getElementById('aemi-policy-btn').addEventListener('click', () => {
      const policyPath = document.getElementById('aemi-policy-path').textContent;
      if (policyPath && policyPath !== '—') {
        window.open(`${currentBaseUrl}/crx/de#${policyPath}`, '_blank');
      }
    });

    // Keep tooltip open on hover
    tooltip.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    tooltip.addEventListener('mouseleave', () => { if (!isPinned) scheduleHide(); });
  }

  function populateTooltip(el) {
    const data = extractComponentData(el);
    currentPath = data.path;

    document.getElementById('aemi-name').textContent = formatComponentName(data.componentName);
    document.getElementById('aemi-resource').textContent = data.resourceType || '—';
    document.getElementById('aemi-path').textContent = data.path || '—';
    document.getElementById('aemi-template').textContent = data.template || '—';
    document.getElementById('aemi-policy-path').textContent = data.policyAttr || '—';

    // Render DOM-extracted props
    renderProps(data.props);

    // Fetch live data from AEM API
    if (data.path) {
      fetchLiveData(data.path);
    }
  }

  function renderProps(props) {
    const container = document.getElementById('aemi-props');
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
      row.innerHTML = `<span class="aemi-key">${key}</span><span class="aemi-val ${valClass}">${val}</span>`;
      container.appendChild(row);
    });
  }

  const JCR_SKIP = ['jcr:primaryType', 'jcr:mixinTypes', 'jcr:uuid', 'jcr:created', 'jcr:createdBy'];

  function renderObjectAsTree(container, obj, depth) {
    if (!obj || typeof obj !== 'object') return;

    // Separate primitives from nested objects for better grouping
    const entries = Object.entries(obj).filter(([k]) => !JCR_SKIP.includes(k));
    const primitives = entries.filter(([, v]) => v === null || typeof v !== 'object');
    const nested = entries.filter(([, v]) => v !== null && typeof v === 'object');

    // Render primitives first
    primitives.forEach(([key, val]) => {
      renderTreeNode(key, val, depth, container);
    });

    // Add separator if we have both types
    if (primitives.length > 0 && nested.length > 0) {
      const sep = document.createElement('div');
      sep.className = 'aemi-tree-separator';
      container.appendChild(sep);
    }

    // Then render nested objects (auto-expand at depth 0)
    nested.forEach(([key, val]) => {
      const autoExpand = depth === 0;
      renderTreeNode(key, val, depth, container, autoExpand);
    });
  }

  function buildPreview(value) {
    // Build a short preview string for collapsed object nodes
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
    // Depth cap — show link to open full JSON
    if (depth > 2) {
      const link = document.createElement('div');
      link.className = 'aemi-prop-row aemi-tree-deep-link';
      link.innerHTML = `<span class="aemi-key">${key}</span><span class="aemi-val aemi-val--path" onclick="window.open('${currentBaseUrl}${currentPath}.infinity.json','_blank')">{ } Open in JSON</span>`;
      container.appendChild(link);
      return;
    }

    const isObject = value !== null && typeof value === 'object';
    const isArray = Array.isArray(value);

    // Primitive value — flat row
    if (!isObject) {
      const row = document.createElement('div');
      row.className = 'aemi-prop-row';
      const strVal = value === null ? '—' : String(value);
      const truncated = strVal.length > 50 ? strVal.substring(0, 47) + '...' : strVal;
      const valClass = strVal.startsWith('/') ? 'aemi-val--path' :
                       strVal === 'true' ? 'aemi-val--green' :
                       strVal === 'false' ? 'aemi-val--yellow' : '';
      const titleAttr = strVal.length > 50 ? ` title="${strVal.replace(/"/g, '&quot;')}"` : '';
      row.innerHTML = `<span class="aemi-key">${key}</span><span class="aemi-val ${valClass}"${titleAttr}>${truncated}</span>`;
      container.appendChild(row);
      return;
    }

    // Object or array — collapsible node
    const childKeys = Object.keys(value).filter(k => !JCR_SKIP.includes(k));
    const childCount = childKeys.length;
    const typeLabel = isArray ? 'item' : 'child';
    const badgeClass = isArray ? 'aemi-tree-badge aemi-tree-badge--array' : 'aemi-tree-badge';

    // Build preview for collapsed state
    const preview = childCount > 0 ? buildPreview(value) : 'empty';

    // Toggle row
    const toggle = document.createElement('div');
    toggle.className = 'aemi-tree-toggle';
    if (depth > 0) toggle.classList.add(`aemi-tree-depth-${depth}`);
    toggle.innerHTML = `
      <span class="aemi-tree-arrow">▸</span>
      <span class="aemi-tree-key">${key}</span>
      <span class="${badgeClass}">${childCount} ${childCount === 1 ? typeLabel : typeLabel + 's'}</span>
    `;

    // Preview text (shown when collapsed)
    const previewEl = document.createElement('div');
    previewEl.className = 'aemi-tree-preview';
    if (depth > 0) previewEl.classList.add(`aemi-tree-depth-${depth}`);
    previewEl.textContent = preview;

    // Children container (hidden by default)
    const childContainer = document.createElement('div');
    childContainer.className = 'aemi-tree-children';

    // Render children into container
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

    // Auto-expand at depth 0
    if (autoExpand && childCount > 0) {
      toggle.classList.add('aemi-tree-open');
      toggle.querySelector('.aemi-tree-arrow').classList.add('open');
      childContainer.classList.add('open');
      previewEl.classList.add('aemi-tree-preview--hidden');
      expandNode();
    }
  }

  function fetchLiveData(path) {
    const status = document.getElementById('aemi-fetch-status');
    status.style.display = 'block';
    status.textContent = '⟳ Fetching live data...';

    chrome.runtime.sendMessage(
      { type: 'FETCH_COMPONENT_DATA', path, baseUrl: currentBaseUrl },
      (response) => {
        status.style.display = 'none';
        if (!response || !response.success) return;

        const liveData = response.data;

        // Enrich props with live .json data using tree renderer
        if (liveData.properties) {
          const container = document.getElementById('aemi-props');
          container.innerHTML = '';

          // Add structure summary
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
        }

        // Update policy path if found
        if (liveData.policyPath) {
          document.getElementById('aemi-policy-path').textContent = liveData.policyPath;
        }
      }
    );
  }

  function formatComponentName(name) {
    return name
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  // ── Tooltip Positioning ────────────────────────────────────────────────────
  function positionTooltip(e) {
    const TIP_W = 340;
    const TIP_H = 500;
    const OFFSET = 16;
    const winW = window.innerWidth;
    const winH = window.innerHeight;

    let left = e.clientX + OFFSET;
    let top = e.clientY + OFFSET;

    if (left + TIP_W > winW - 12) left = e.clientX - TIP_W - OFFSET;
    if (top + TIP_H > winH - 12) top = e.clientY - TIP_H - OFFSET;
    if (left < 8) left = 8;
    if (top < 8) top = 8;

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function showTooltip() {
    tooltip.classList.add('aemi--visible');
  }

  function hideTooltip() {
    if (!isPinned) tooltip.classList.remove('aemi--visible');
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
  function observeDOM() {
    const observer = new MutationObserver(() => {
      // Re-check if still on AEM author page after DOM changes
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ── Copy Feedback ──────────────────────────────────────────────────────────
  function showCopyFeedback(btnId, text) {
    const btn = document.getElementById(btnId);
    const original = btn.textContent;
    btn.textContent = text;
    btn.style.color = '#2ecc71';
    setTimeout(() => {
      btn.textContent = original;
      btn.style.color = '';
    }, 1500);
  }

  // ── Start ──────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
