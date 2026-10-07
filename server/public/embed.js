/*!
 * Contextly embed script — visual feedback for any prototype.
 * Usage (v2):
 *   <script src="https://your-host/embed/v1.js" data-project-id="proj_x" data-round-id="round_x" defer></script>
 * Legacy token URLs (/embed/{token}.js) keep working.
 * Zero runtime dependencies. Renders inside a shadow DOM so host page styles are untouched.
 */
(function () {
  'use strict';

  if (window.__CONTEXTLY_EMBED__) return;
  window.__CONTEXTLY_EMBED__ = true;

  // ---- Resolve project / round from script attributes, then legacy URL token ----
  var script =
    document.currentScript ||
    (function () {
      var all = document.getElementsByTagName('script');
      for (var i = all.length - 1; i >= 0; i--) if (/\/embed\//.test(all[i].src)) return all[i];
      return null;
    })();
  if (!script) return;

  var PROJECT_ID = script.getAttribute('data-project-id');
  var ROUND_ID = script.getAttribute('data-round-id');
  var TOKEN = PROJECT_ID;
  if (!TOKEN) {
    var m = script.src.match(/\/embed\/([A-Za-z0-9_-]+?)(?:\.js)?(?:\?|$)/);
    if (!m || m[1] === 'v1' || m[1] === 'html2canvas.min') return;
    TOKEN = m[1];
  }
  var API = script.src.split('/embed/')[0];

  var COLORS = { primary: '#4f46e5', open: '#e11d48', progress: '#f59e0b', resolved: '#10b981' };
  var TYPES = [
    ['bug', '🐞 Bug'], ['design_change', '🎨 Design change'], ['ux', '🧭 UX concern'],
    ['content', '✏️ Content change'], ['accessibility', '♿ Accessibility'], ['performance', '⚡ Performance'],
    ['question', '❓ Question'], ['other', '💬 Other'],
  ];
  var PRIORITIES = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['critical', 'Critical']];
  var CATEGORIES = ['layout', 'typography', 'color', 'spacing', 'interaction', 'navigation', 'content', 'responsive', 'accessibility', 'technical'];

  var state = {
    projectName: '',
    round: null,
    version: null,
    comments: [],
    mode: 'idle', // idle | element | region
    collapsed: localStorage.getItem('ctx:collapsed') !== '0',
    activeThreadId: null,
    composer: null, // { kind:'element'|'region', el, selector, snapshot, region }
    reviewerName: localStorage.getItem('ctx:name') || '',
    reviewerEmail: localStorage.getItem('ctx:email') || '',
    filter: 'all', // all | open | resolved | mine
    search: '',
    regionDraft: null,
  };

  // ------------------------------------------------------------------
  // Utilities
  // ------------------------------------------------------------------
  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    return fetch(API + path, opts).then(function (r) {
      if (!r.ok) return r.json().then(function (e) { throw new Error(e.error || ('HTTP ' + r.status)); });
      return r.json();
    });
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function relTime(iso) {
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  function refNum(ref) {
    return ref ? String(parseInt(ref.split('-')[1] || '0', 10)) : '?';
  }

  // ---- Technical metadata capture ----
  var consoleErrors = [];
  (function hookConsole() {
    try {
      var orig = console.error;
      console.error = function () {
        if (consoleErrors.length < 10) {
          var msg = Array.prototype.map.call(arguments, function (a) {
            return typeof a === 'string' ? a : (a && a.message) || String(a);
          }).join(' ');
          consoleErrors.push(msg.slice(0, 300));
        }
        orig.apply(console, arguments);
      };
    } catch (e) { /* ignore */ }
  })();

  function techMeta() {
    var ua = navigator.userAgent;
    var browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Unknown';
    var os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown';
    return {
      browser: browser,
      os: os,
      viewport: window.innerWidth + 'x' + window.innerHeight,
      device_pixel_ratio: window.devicePixelRatio || 1,
      locale: navigator.language || null,
      timezone: (Intl.DateTimeFormat().resolvedOptions().timeZone) || null,
      url: location.href,
      user_agent: ua.slice(0, 300),
      console_errors: consoleErrors.slice(),
      captured_at: new Date().toISOString(),
    };
  }

  // ---- Element identification ----
  function cssPathParts(node) {
    var parts = [];
    while (node && node.nodeType === 1 && node.tagName !== 'HTML') {
      var part = node.tagName.toLowerCase();
      if (node.id) { parts.unshift('#' + node.id); break; }
      var cls = (node.classList || []).length ? '.' + Array.prototype.slice.call(node.classList, 0, 2).join('.') : '';
      var parent = node.parentElement;
      if (parent) {
        var sibs = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === node.tagName; });
        if (sibs.length > 1) part += ':nth-of-type(' + (sibs.indexOf(node) + 1) + ')';
      }
      parts.unshift(part + cls);
      node = parent;
    }
    return parts;
  }

  function buildSelector(target) {
    if (target.id) return '#' + target.id;
    return cssPathParts(target).join(' > ');
  }

  function buildSnapshot(target) {
    var box = target.getBoundingClientRect();
    var tagNames = [];
    var n = target;
    while (n && n.nodeType === 1 && tagNames.length < 8) { tagNames.unshift(n.tagName.toLowerCase()); n = n.parentElement; }
    var text = (target.innerText || target.textContent || '').replace(/\s+/g, ' ').trim();
    return {
      tag: target.tagName.toLowerCase(),
      classList: Array.prototype.slice.call(target.classList),
      textSnippet: text.slice(0, 40),
      fallbackPath: tagNames,
      boundingBox: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) },
    };
  }

  function elementLabel(f) {
    if (f.region) return 'Custom region';
    var snap = f.element_snapshot || {};
    var label = snap.tag ? '<' + snap.tag + '>' : '';
    if (snap.textSnippet) label += ' "' + snap.textSnippet + '"';
    return label || f.element_selector;
  }

  function resolveElement(comment) {
    try {
      var found = document.querySelector(comment.element_selector);
      if (found) return found;
    } catch (e) { /* invalid selector */ }
    var snap = comment.element_snapshot || {};
    var path = snap.fallbackPath || [];
    var candidates = document.getElementsByTagName(path[path.length - 1] || 'body');
    for (var i = 0; i < candidates.length; i++) {
      var t = (candidates[i].innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (snap.textSnippet && t === snap.textSnippet) return candidates[i];
    }
    return null;
  }

  // ---- Polling ----
  var pollTimer = null;
  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      if (document.hidden || state.mode !== 'idle') return;
      refreshComments().catch(function () {});
    }, 5000);
  }

  function refreshComments() {
    return api('/api/embed/' + TOKEN + '/comments').then(function (data) {
      state.comments = data.comments || [];
      renderPins();
      renderList();
      if (state.activeThreadId) {
        var still = state.comments.filter(function (c) { return c.id === state.activeThreadId; })[0];
        if (!still) { state.activeThreadId = null; renderPanel(); }
        else if (!typingInPanel()) renderThreadDetail(still);
      }
    });
  }

  function typingInPanel() {
    var active = root.activeElement;
    return !!active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT');
  }

  // ------------------------------------------------------------------
  // Shadow DOM scaffold
  // ------------------------------------------------------------------
  var host = el('div');
  host.id = 'contextly-embed-host';
  host.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;pointer-events:none;z-index:2147483000;';
  document.documentElement.appendChild(host);
  var root = host.attachShadow({ mode: 'open' });

  var style = el('style');
  style.textContent = [
    ':host{all:initial;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#1e293b;}',
    '*{box-sizing:border-box;margin:0;}',
    'button{font:inherit;cursor:pointer;border:none;background:none;}',
    'input,select,textarea{font:inherit;}',
    '.ctx-outline{position:fixed;pointer-events:none;border:2px solid ' + COLORS.primary + ';border-radius:4px;background:rgba(79,70,229,.08);z-index:2147483001;}',
    '.ctx-outline-tag{position:absolute;top:-22px;left:-2px;background:' + COLORS.primary + ';color:#fff;font-size:11px;line-height:20px;padding:0 6px;border-radius:4px 4px 4px 0;white-space:nowrap;max-width:260px;overflow:hidden;text-overflow:ellipsis;}',
    '.ctx-region-draft{position:fixed;pointer-events:none;border:2px dashed ' + COLORS.primary + ';background:rgba(79,70,229,.12);z-index:2147483001;}',
    '.ctx-highlight{position:fixed;pointer-events:none;border:2px solid ' + COLORS.progress + ';border-radius:4px;background:rgba(245,158,11,.10);z-index:2147482999;}',
    '.ctx-pin{position:absolute;pointer-events:auto;min-width:24px;height:24px;padding:0 5px;border-radius:12px 12px 12px 3px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:800;box-shadow:0 2px 8px rgba(0,0,0,.3);cursor:pointer;border:2px solid #fff;font-family:ui-monospace,monospace;}',
    '.ctx-pin[data-status="open"],.ctx-pin[data-status="reopened"]{background:' + COLORS.open + ';}',
    '.ctx-pin[data-status="in_progress"]{background:' + COLORS.progress + ';}',
    '.ctx-pin[data-status="resolved"]{background:' + COLORS.resolved + ';}',
    '.ctx-composer{position:absolute;pointer-events:auto;width:320px;background:#fff;border-radius:14px;box-shadow:0 12px 40px rgba(15,23,42,.25);border:1px solid #e2e8f0;overflow:hidden;z-index:2147483002;}',
    '.ctx-panel{position:absolute;top:14px;right:14px;bottom:14px;width:340px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 18px 50px rgba(15,23,42,.22);display:flex;flex-direction:column;pointer-events:auto;overflow:hidden;}',
    '.ctx-detail{position:absolute;top:14px;right:14px;bottom:14px;width:340px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 18px 50px rgba(15,23,42,.22);display:flex;flex-direction:column;pointer-events:auto;overflow:hidden;}',
    '.ctx-head{padding:12px 14px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;gap:8px;}',
    '.ctx-logo{width:26px;height:26px;border-radius:8px;background:' + COLORS.primary + ';color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;flex:none;}',
    '.ctx-title{font-weight:700;font-size:13.5px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.ctx-sub{font-size:11px;color:#94a3b8;font-weight:400;}',
    '.ctx-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border-radius:8px;padding:7px 12px;font-weight:600;font-size:13px;}',
    '.ctx-btn-primary{background:' + COLORS.primary + ';color:#fff;}',
    '.ctx-btn-primary:hover{background:#4338ca;}',
    '.ctx-btn-ghost{color:#475569;}',
    '.ctx-btn-ghost:hover{background:#f1f5f9;}',
    '.ctx-tabs{display:flex;gap:2px;padding:8px 10px;border-bottom:1px solid #e2e8f0;}',
    '.ctx-tab{flex:1;padding:6px 4px;border-radius:6px;font-size:12px;font-weight:600;color:#64748b;text-align:center;}',
    '.ctx-tab:hover{background:#f1f5f9;}',
    '.ctx-tab[data-active="1"]{background:' + COLORS.primary + ';color:#fff;}',
    '.ctx-list{flex:1;overflow-y:auto;padding:8px;}',
    '.ctx-item{padding:10px 12px;border-radius:10px;cursor:pointer;border:1px solid transparent;}',
    '.ctx-item:hover{background:#f8fafc;border-color:#e2e8f0;}',
    '.ctx-item-top{display:flex;align-items:center;gap:6px;margin-bottom:3px;}',
    '.ctx-num{font-family:ui-monospace,monospace;font-size:10.5px;font-weight:800;color:' + COLORS.primary + ';background:#eef2ff;padding:1px 6px;border-radius:6px;}',
    '.ctx-badge{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:999px;text-transform:uppercase;letter-spacing:.02em;}',
    '.ctx-badge-open{background:#ffe4e6;color:' + COLORS.open + ';}',
    '.ctx-badge-in_progress{background:#fef3c7;color:#b45309;}',
    '.ctx-badge-resolved{background:#d1fae5;color:#047857;}',
    '.ctx-badge-reopened{background:#ffe4e6;color:' + COLORS.open + ';}',
    '.ctx-item-title{font-size:13px;font-weight:600;color:#0f172a;line-height:1.4;}',
    '.ctx-text{font-size:12.5px;color:#475569;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}',
    '.ctx-meta{font-size:11px;color:#94a3b8;margin-top:4px;}',
    '.ctx-empty{padding:32px 20px;text-align:center;color:#94a3b8;font-size:13px;line-height:1.6;}',
    '.ctx-foot{padding:9px 14px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;display:flex;align-items:center;justify-content:space-between;gap:8px;}',
    '.ctx-msg{padding:10px 12px;border-radius:10px;background:#f8fafc;margin:6px 12px 0;}',
    '.ctx-msg-head{font-size:12px;font-weight:700;color:#0f172a;display:flex;justify-content:space-between;gap:8px;}',
    '.ctx-msg-time{font-weight:400;color:#94a3b8;font-size:11px;}',
    '.ctx-msg-body{font-size:13px;color:#334155;line-height:1.5;margin-top:3px;white-space:pre-wrap;word-break:break-word;}',
    '.ctx-input{width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;font-size:13px;resize:none;outline:none;background:#fff;color:#1e293b;}',
    '.ctx-input:focus{border-color:' + COLORS.primary + ';box-shadow:0 0 0 3px rgba(79,70,229,.15);}',
    '.ctx-fab{position:absolute;bottom:20px;right:20px;width:46px;height:46px;border-radius:50%;background:' + COLORS.primary + ';color:#fff;font-size:19px;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 20px rgba(79,70,229,.45);pointer-events:auto;}',
    '.ctx-fab .ctx-fab-count{position:absolute;top:-4px;right:-4px;background:' + COLORS.open + ';border:2px solid #fff;min-width:18px;height:18px;border-radius:9px;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 4px;color:#fff;}',
    '.ctx-selectbar{position:absolute;top:14px;left:50%;transform:translateX(-50%);pointer-events:auto;background:#0f172a;color:#fff;padding:8px 8px 8px 14px;border-radius:999px;font-size:13px;display:flex;gap:10px;align-items:center;box-shadow:0 8px 24px rgba(0,0,0,.35);}',
    '.ctx-selectbar .ctx-mode{display:flex;background:rgba(255,255,255,.12);border-radius:999px;padding:2px;}',
    '.ctx-selectbar .ctx-mode button{color:#cbd5e1;font-weight:600;font-size:12px;padding:4px 10px;border-radius:999px;}',
    '.ctx-selectbar .ctx-mode button[data-on="1"]{background:' + COLORS.primary + ';color:#fff;}',
    '.ctx-selectbar .ctx-cancel{color:#93c5fd;font-weight:600;font-size:13px;padding:4px 8px;}',
    '.ctx-toast{position:absolute;bottom:20px;left:50%;transform:translateX(-50%);background:#0f172a;color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;pointer-events:auto;box-shadow:0 8px 24px rgba(0,0,0,.3);max-width:80%;}',
    '.ctx-approve{border-top:1px solid #e2e8f0;padding:10px 14px;display:flex;gap:8px;}',
    '.ctx-shot{width:100%;border-radius:8px;border:1px solid #e2e8f0;display:block;}',
    '.ctx-ai{margin:8px 0;padding:10px;border:1px solid #c7d2fe;background:#eef2ff;border-radius:10px;font-size:12.5px;color:#3730a3;line-height:1.5;}',
    '.ctx-ai .ctx-ai-label{font-weight:700;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;}',
  ].join('\n');
  root.appendChild(style);

  var layer = el('div');
  layer.style.cssText = 'position:absolute;inset:0;';
  root.appendChild(layer);

  function fitPanel() {
    var panel = layer.querySelector('.ctx-panel, .ctx-detail');
    if (!panel) return;
    if (window.innerWidth < 480) panel.style.cssText += 'top:0;right:0;bottom:0;left:0;width:100vw;border-radius:0;';
    else panel.style.width = '340px';
  }
  window.addEventListener('resize', function () { fitPanel(); renderPins(); });

  // ------------------------------------------------------------------
  // Selection modes
  // ------------------------------------------------------------------
  var outline = el('div', 'ctx-outline');
  outline.appendChild(el('div', 'ctx-outline-tag'));
  outline.style.display = 'none';
  layer.appendChild(outline);

  var regionDraft = el('div', 'ctx-region-draft');
  regionDraft.style.display = 'none';
  layer.appendChild(regionDraft);

  var highlight = el('div', 'ctx-highlight');
  highlight.style.display = 'none';
  layer.appendChild(highlight);

  function onHover(e) {
    if (state.mode !== 'element') return;
    var t = e.target;
    if (t === host || host.contains(t) || t === document.documentElement || t === document.body) return hide(outline);
    var box = t.getBoundingClientRect();
    outline.style.display = 'block';
    outline.style.left = box.x + 'px';
    outline.style.top = box.y + 'px';
    outline.style.width = box.width + 'px';
    outline.style.height = box.height + 'px';
    var label = t.tagName.toLowerCase();
    if (t.id) label += '#' + t.id;
    else if (typeof t.className === 'string' && t.className.trim()) label += '.' + t.className.trim().split(/\s+/).slice(0, 2).join('.');
    outline.firstChild.textContent = label;
  }

  function onClick(e) {
    if (state.mode === 'idle') return;
    if (e.target === host || host.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    if (state.mode === 'element') {
      var t = e.target;
      if (t === document.documentElement || t === document.body) return;
      setMode('idle');
      state.composer = { kind: 'element', el: t, selector: buildSelector(t), snapshot: buildSnapshot(t), region: null };
      renderComposer();
    }
  }

  function hide(n) { n.style.display = 'none'; }

  function setMode(mode) {
    state.mode = mode;
    document.body.style.userSelect = mode === 'idle' ? '' : 'none';
    if (mode === 'idle') {
      document.removeEventListener('mouseover', onHover, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('mousedown', onRegionStart, true);
      document.removeEventListener('mousemove', onRegionMove, true);
      document.removeEventListener('mouseup', onRegionEnd, true);
      hide(outline); hide(regionDraft);
      var bars = layer.querySelectorAll('.ctx-selectbar');
      for (var i = 0; i < bars.length; i++) bars[i].remove();
    } else {
      document.addEventListener('mouseover', onHover, true);
      document.addEventListener('click', onClick, true);
      if (mode === 'region') {
        document.addEventListener('mousedown', onRegionStart, true);
        document.addEventListener('mousemove', onRegionMove, true);
        document.addEventListener('mouseup', onRegionEnd, true);
        hide(outline);
      } else {
        document.removeEventListener('mousedown', onRegionStart, true);
        document.removeEventListener('mousemove', onRegionMove, true);
        document.removeEventListener('mouseup', onRegionEnd, true);
      }
      renderSelectBar();
    }
  }

  var regionStart = null;
  function onRegionStart(e) {
    if (state.mode !== 'region' || e.target === host || host.contains(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    regionStart = { x: e.clientX, y: e.clientY };
  }
  function onRegionMove(e) {
    if (!regionStart) return;
    var x = Math.min(regionStart.x, e.clientX), y = Math.min(regionStart.y, e.clientY);
    var w = Math.abs(e.clientX - regionStart.x), h = Math.abs(e.clientY - regionStart.y);
    regionDraft.style.display = 'block';
    regionDraft.style.left = x + 'px'; regionDraft.style.top = y + 'px';
    regionDraft.style.width = w + 'px'; regionDraft.style.height = h + 'px';
  }
  function onRegionEnd(e) {
    if (!regionStart) return;
    var x = Math.min(regionStart.x, e.clientX), y = Math.min(regionStart.y, e.clientY);
    var w = Math.abs(e.clientX - regionStart.x), h = Math.abs(e.clientY - regionStart.y);
    regionStart = null;
    hide(regionDraft);
    if (w < 8 || h < 8) return; // ignore tiny drags
    setMode('idle');
    state.composer = {
      kind: 'region',
      el: null, selector: '(region)',
      snapshot: { tag: 'region' },
      region: {
        x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h),
        scroll_x: window.scrollX, scroll_y: window.scrollY,
        viewport: window.innerWidth + 'x' + window.innerHeight,
        page_path: location.pathname,
      },
    };
    renderComposer();
  }

  function renderSelectBar() {
    var bar = el('div', 'ctx-selectbar');
    var wrap = el('div', 'ctx-mode');
    var btnEl = el('button', null, 'Element');
    btnEl.dataset.on = state.mode === 'element' ? '1' : '0';
    btnEl.addEventListener('click', function () { setMode('element'); });
    var btnRegion = el('button', null, 'Region');
    btnRegion.dataset.on = state.mode === 'region' ? '1' : '0';
    btnRegion.addEventListener('click', function () { setMode('region'); });
    wrap.appendChild(btnEl); wrap.appendChild(btnRegion);
    bar.appendChild(el('span', null, state.mode === 'region' ? 'Drag a rectangle over the area' : 'Click an element to leave feedback'));
    bar.appendChild(wrap);
    var cancel = el('button', 'ctx-cancel', 'Done');
    cancel.addEventListener('click', function () { setMode('idle'); });
    bar.appendChild(cancel);
    layer.appendChild(bar);
  }

  // ------------------------------------------------------------------
  // Screenshots (lazy html2canvas, cropped to the target)
  // ------------------------------------------------------------------
  function loadHtml2Canvas() {
    if (window.html2canvas) return Promise.resolve(window.html2canvas);
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = API + '/embed/html2canvas.min.js';
      s.onload = function () { resolve(window.html2canvas); };
      s.onerror = function () { reject(new Error('offline')); };
      document.head.appendChild(s);
    });
  }

  function captureScreenshot(target, region) {
    return loadHtml2Canvas()
      .then(function (h2c) {
        var opts = { backgroundColor: null, logging: false, scale: Math.min(window.devicePixelRatio || 1, 2) };
        if (target) return h2c(target, opts);
        return h2c(document.body, Object.assign({}, opts, {
          x: window.scrollX, y: window.scrollY, width: window.innerWidth, height: window.innerHeight,
        }));
      })
      .then(function (canvas) {
        var sx = 0, sy = 0, sw = canvas.width, sh = canvas.height;
        if (region) {
          var scaleX = canvas.width / document.documentElement.scrollWidth;
          var scaleY = canvas.height / document.documentElement.scrollHeight;
          sw = Math.max(10, region.w * scaleX); sh = Math.max(10, region.h * scaleY);
          sx = region.x * scaleX; sy = (region.y + (region.scroll_y || 0)) * scaleY;
          sx = Math.max(0, Math.min(sx, canvas.width - sw));
          sy = Math.max(0, Math.min(sy, canvas.height - sh));
        } else if (target) {
          var box = target.getBoundingClientRect();
          sx = box.x * (canvas.width / document.documentElement.scrollWidth);
          sy = box.y * (canvas.height / document.documentElement.scrollHeight);
          sw = box.width * (canvas.width / document.documentElement.scrollWidth);
          sh = box.height * (canvas.height / document.documentElement.scrollHeight);
          sx = Math.max(0, sx); sy = Math.max(0, sy);
          sw = Math.min(sw, canvas.width - sx); sh = Math.min(sh, canvas.height - sy);
        }
        var crop = document.createElement('canvas');
        var maxW = 900;
        var scale = Math.min(1, maxW / sw);
        crop.width = Math.round(sw * scale);
        crop.height = Math.round(sh * scale);
        var ctx = crop.getContext('2d');
        ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, crop.width, crop.height);
        return crop.toDataURL('image/jpeg', 0.6);
      })
      .catch(function () { return null; }); // screenshots are best-effort
  }

  // ------------------------------------------------------------------
  // Composer
  // ------------------------------------------------------------------
  function removeComposer() {
    var b = layer.querySelectorAll('.ctx-composer');
    for (var i = 0; i < b.length; i++) b[i].remove();
  }

  function renderComposer() {
    removeComposer();
    var c = state.composer;
    if (!c) return;

    var bubble = el('div', 'ctx-composer');
    var head = el('div');
    head.style.cssText = 'padding:10px 14px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b;';
    head.textContent = (c.kind === 'region' ? 'Region ' + c.region.w + '×' + c.region.h + 'px' : elementLabel({ element_snapshot: c.snapshot, element_selector: c.selector }));
    bubble.appendChild(head);

    var body = el('div');
    body.style.cssText = 'padding:10px 14px;display:flex;flex-direction:column;gap:8px;';

    var title = el('input', 'ctx-input');
    title.placeholder = 'Short title (e.g. "CTA spacing on mobile")';
    body.appendChild(title);

    var ta = el('textarea', 'ctx-input');
    ta.rows = 3;
    ta.placeholder = 'Describe the feedback — what should change and why?';
    body.appendChild(ta);

    var aiBox = el('div');
    aiBox.style.display = 'none';
    body.appendChild(aiBox);

    var aiRow = el('div');
    aiRow.style.cssText = 'display:flex;justify-content:flex-end;';
    var aiBtn = el('button', 'ctx-btn ctx-btn-ghost', '✨ Improve with AI');
    aiBtn.style.fontSize = '12px';
    aiRow.appendChild(aiBtn);
    body.appendChild(aiRow);

    var row1 = el('div');
    row1.style.cssText = 'display:flex;gap:8px;';
    var selType = el('select', 'ctx-input');
    TYPES.forEach(function (t) { var o = el('option', null, t[1]); o.value = t[0]; selType.appendChild(o); });
    var selPri = el('select', 'ctx-input');
    PRIORITIES.forEach(function (p) { var o = el('option', null, p[1]); o.value = p[0]; selPri.appendChild(o); });
    selPri.value = 'medium';
    row1.appendChild(selType); row1.appendChild(selPri);
    body.appendChild(row1);

    var row2 = el('div');
    var selCat = el('select', 'ctx-input');
    selCat.appendChild(el('option', null, 'Category (optional)')).value = '';
    CATEGORIES.forEach(function (cat) { var o = el('option', null, cat.charAt(0).toUpperCase() + cat.slice(1)); o.value = cat; selCat.appendChild(o); });
    row2.appendChild(selCat);
    body.appendChild(row2);

    var row3 = el('div');
    row3.style.cssText = 'display:flex;gap:8px;';
    var nameIn = el('input', 'ctx-input');
    nameIn.placeholder = 'Your name';
    nameIn.value = state.reviewerName;
    var emailIn = el('input', 'ctx-input');
    emailIn.placeholder = 'Email (optional)';
    emailIn.value = state.reviewerEmail;
    row3.appendChild(nameIn); row3.appendChild(emailIn);
    body.appendChild(row3);

    var actions = el('div');
    actions.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;align-items:center;';
    var shotNote = el('span', null, '');
    shotNote.style.cssText = 'font-size:11px;color:#94a3b8;margin-right:auto;';
    var cancel = el('button', 'ctx-btn ctx-btn-ghost', 'Cancel');
    var send = el('button', 'ctx-btn ctx-btn-primary', 'Submit feedback');
    actions.appendChild(shotNote); actions.appendChild(cancel); actions.appendChild(send);
    body.appendChild(actions);
    bubble.appendChild(body);

    var left, top;
    if (c.kind === 'region') {
      left = Math.min(c.region.x + c.region.w - 10, window.innerWidth - 340);
      top = Math.min(c.region.y + c.region.h + 8, window.innerHeight - 380);
    } else {
      var box = c.el.getBoundingClientRect();
      left = Math.min(box.right - 10, window.innerWidth - 340);
      top = Math.min(box.bottom + 8, window.innerHeight - 380);
    }
    bubble.style.left = Math.max(8, left) + 'px';
    bubble.style.top = Math.max(8, top) + 'px';
    layer.appendChild(bubble);
    title.focus();

    cancel.addEventListener('click', function () { removeComposer(); state.composer = null; });

    // Rule-based AI assist: never overwrites the original text; shows a suggestion card
    aiBtn.addEventListener('click', function () {
      var text = ta.value.trim();
      if (!text) { ta.focus(); return; }
      aiBtn.disabled = true; aiBtn.textContent = 'Analyzing…';
      api('/api/embed/' + TOKEN + '/ai-refine', {
        method: 'POST',
        body: JSON.stringify({ content: text, element_label: c.kind === 'region' ? null : (c.snapshot.textSnippet || c.snapshot.tag) }),
      })
        .then(function (s) {
          aiBox.innerHTML = '';
          aiBox.style.display = 'block';
          var card = el('div', 'ctx-ai');
          card.appendChild(el('div', 'ctx-ai-label', '✨ AI suggestion — review before applying'));
          if (s.title) card.appendChild(el('div', null, 'Title: ' + s.title));
          if (s.clarified) {
            var cl = el('div', null, s.clarified);
            cl.style.cssText = 'margin-top:4px;';
            card.appendChild(cl);
          }
          if (s.type) {
            var meta = el('div', null, 'Detected: ' + s.type + (s.category ? ' · ' + s.category : '') + (s.priority_suggestion ? ' · priority: ' + s.priority_suggestion : ''));
            meta.style.cssText = 'margin-top:4px;font-size:11.5px;color:#6366f1;';
            card.appendChild(meta);
          }
          var apply = el('button', 'ctx-btn ctx-btn-primary', 'Accept');
          apply.style.cssText = 'margin-top:6px;font-size:12px;padding:4px 10px;';
          apply.addEventListener('click', function () {
            if (s.title) title.value = s.title;
            if (s.clarified) ta.value = s.clarified;
            if (s.type) selType.value = s.type;
            if (s.category) selCat.value = s.category;
            if (s.priority_suggestion) selPri.value = s.priority_suggestion;
            aiBox.style.display = 'none';
          });
          var ignore = el('button', 'ctx-btn ctx-btn-ghost', 'Ignore');
          ignore.style.cssText = 'margin-top:6px;font-size:12px;padding:4px 10px;margin-left:6px;';
          ignore.addEventListener('click', function () { aiBox.style.display = 'none'; });
          card.appendChild(apply); card.appendChild(ignore);
          aiBox.appendChild(card);
          if (s.title && !title.value) title.value = s.title;
        })
        .catch(function () { /* silent */ })
        .then(function () { aiBtn.disabled = false; aiBtn.textContent = '✨ Improve with AI'; });
    });

    send.addEventListener('click', function () {
      var text = ta.value.trim();
      if (!text) { ta.focus(); return; }
      if (nameIn.value.trim()) { state.reviewerName = nameIn.value.trim(); localStorage.setItem('ctx:name', state.reviewerName); }
      if (emailIn.value.trim()) { state.reviewerEmail = emailIn.value.trim(); localStorage.setItem('ctx:email', state.reviewerEmail); }
      send.disabled = true; send.textContent = 'Capturing…';
      shotNote.textContent = 'Capturing screenshot…';

      captureScreenshot(c.kind === 'element' ? c.el : null, c.kind === 'region' ? c.region : null)
        .then(function (shot) {
          send.textContent = 'Submitting…';
          shotNote.textContent = shot ? 'Screenshot attached ✓' : '';
          return api('/api/embed/' + TOKEN + '/comments', {
            method: 'POST',
            body: JSON.stringify({
              content: text,
              title: title.value.trim() || null,
              element_selector: c.selector,
              element_snapshot: c.snapshot,
              region: c.region,
              page_url: location.href,
              type: selType.value,
              category: selCat.value || null,
              priority: selPri.value,
              round_id: state.round ? state.round.id : null,
              author_name: state.reviewerName || 'Guest reviewer',
              author_email: state.reviewerEmail || null,
              screenshot: shot,
              tech_meta: techMeta(),
            }),
          });
        })
        .then(function () {
          removeComposer();
          state.composer = null;
          toast('Thanks! Feedback submitted.');
          return refreshComments();
        })
        .catch(function (err) {
          toast(err.message || 'Could not send feedback');
          send.disabled = false; send.textContent = 'Submit feedback';
        });
    });
  }

  // ------------------------------------------------------------------
  // Numbered pins
  // ------------------------------------------------------------------
  function renderPins() {
    var pins = layer.querySelectorAll('.ctx-pin');
    for (var i = 0; i < pins.length; i++) pins[i].remove();

    var items = state.comments.filter(function (c) { return !c.parent_comment_id && c.page_path === location.pathname; });
    items.forEach(function (f, idx) {
      var px, py;
      if (f.region) {
        px = f.region.x + (f.region.scroll_x || 0) - window.scrollX;
        py = f.region.y + (f.region.scroll_y || 0) - window.scrollY;
      } else {
        var target = resolveElement(f);
        if (!target) return; // orphaned
        var box = target.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) return;
        if (box.bottom < 0 || box.top > window.innerHeight) return;
        px = box.right; py = box.top;
      }
      if (px < -30 || py < -30 || px > window.innerWidth + 10 || py > window.innerHeight + 10) return;

      var pin = el('button', 'ctx-pin');
      pin.dataset.status = f.status;
      pin.textContent = refNum(f.ref);
      pin.title = (f.ref || '') + (f.title ? ' — ' + f.title : '') + ' (' + f.status.replace('_', ' ') + ')';
      pin.style.left = px + 4 + 'px';
      pin.style.top = py - 24 - (idx % 5) * 4 + 'px';
      pin.addEventListener('click', function (e) {
        e.stopPropagation();
        state.collapsed = false;
        localStorage.setItem('ctx:collapsed', '0');
        state.activeThreadId = f.id;
        showHighlight(f);
        renderThreadDetail(f);
      });
      layer.appendChild(pin);
    });
  }

  function showHighlight(f) {
    var box = null;
    if (f.region) {
      box = { x: f.region.x - window.scrollX + (f.region.scroll_x || 0), y: f.region.y - window.scrollY + (f.region.scroll_y || 0), w: f.region.w, h: f.region.h };
    } else {
      var target = resolveElement(f);
      if (!target) return;
      var b = target.getBoundingClientRect();
      box = { x: b.x, y: b.y, w: b.width, h: b.height };
    }
    highlight.style.display = 'block';
    highlight.style.left = box.x + 'px';
    highlight.style.top = box.y + 'px';
    highlight.style.width = box.w + 'px';
    highlight.style.height = box.h + 'px';
    clearTimeout(showHighlight._t);
    showHighlight._t = setTimeout(function () { hide(highlight); }, 2500);
  }

  window.addEventListener('scroll', renderPins, { passive: true });

  // ------------------------------------------------------------------
  // Panel
  // ------------------------------------------------------------------
  var panelEl = null;

  function statusBadge(status) {
    var b = el('span', 'ctx-badge ctx-badge-' + status);
    b.textContent = status === 'in_progress' ? 'in progress' : status;
    return b;
  }

  function renderPanel() {
    if (panelEl) panelEl.remove();
    panelEl = null;
    removeFab();
    if (state.collapsed) { renderFab(); return; }

    panelEl = el('div', 'ctx-panel');
    fitPanel();

    // Header: logo, project, round · version
    var head = el('div', 'ctx-head');
    head.appendChild(el('div', 'ctx-logo', 'C'));
    var tw = el('div');
    tw.style.cssText = 'flex:1;min-width:0;';
    tw.appendChild(el('div', 'ctx-title', state.projectName || 'Feedback'));
    var sub = state.round ? state.round.name : '';
    if (state.version) sub += ' · ' + state.version.name;
    tw.appendChild(el('div', 'ctx-sub', sub));
    head.appendChild(tw);
    var selectBtn = el('button', 'ctx-btn ctx-btn-primary', '＋ Feedback');
    selectBtn.addEventListener('click', function () {
      setMode(state.mode === 'idle' ? 'element' : 'idle');
    });
    var collapseBtn = el('button', 'ctx-btn ctx-btn-ghost', '—');
    collapseBtn.title = 'Collapse panel';
    collapseBtn.addEventListener('click', function () {
      state.collapsed = true;
      localStorage.setItem('ctx:collapsed', '1');
      renderPanel();
    });
    head.appendChild(selectBtn);
    head.appendChild(collapseBtn);
    panelEl.appendChild(head);

    // Search
    var searchWrap = el('div');
    searchWrap.style.cssText = 'padding:8px 10px 0;';
    var search = el('input', 'ctx-input');
    search.placeholder = 'Search feedback…';
    search.value = state.search;
    search.addEventListener('input', function () { state.search = search.value; renderList(); });
    searchWrap.appendChild(search);
    panelEl.appendChild(searchWrap);

    // Tabs
    var tabs = el('div', 'ctx-tabs');
    [['all', 'All'], ['open', 'Unresolved'], ['resolved', 'Resolved'], ['mine', 'Mine']].forEach(function (t) {
      var tab = el('button', 'ctx-tab', t[1]);
      tab.dataset.active = state.filter === t[0] ? '1' : '0';
      tab.addEventListener('click', function () { state.filter = t[0]; renderPanel(); });
      tabs.appendChild(tab);
    });
    panelEl.appendChild(tabs);

    var list = el('div', 'ctx-list');
    panelEl.appendChild(list);
    panelEl._list = list;

    // Approval block (client review rounds)
    if (state.round && state.round.requires_approval) {
      var approve = el('div', 'ctx-approve');
      var approveBtn = el('button', 'ctx-btn ctx-btn-primary', '✓ Approve version');
      approveBtn.style.flex = '1';
      var changeBtn = el('button', 'ctx-btn ctx-btn-ghost', 'Request changes');
      approveBtn.addEventListener('click', function () { submitApproval('approved', approveBtn); });
      changeBtn.addEventListener('click', function () { submitApproval('changes_requested', changeBtn); });
      approve.appendChild(approveBtn);
      approve.appendChild(changeBtn);
      panelEl.appendChild(approve);
    }

    var foot = el('div', 'ctx-foot');
    foot.appendChild(el('span', null, '⚡ Contextly'));
    var refresh = el('button', 'ctx-btn ctx-btn-ghost', '↻ Refresh');
    refresh.style.cssText = 'font-size:11px;padding:2px 6px;';
    refresh.addEventListener('click', function () { refreshComments().then(function () { toast('Up to date'); }).catch(function () {}); });
    foot.appendChild(refresh);
    panelEl.appendChild(foot);

    layer.appendChild(panelEl);
    fillList(list);
  }

  function submitApproval(status, btn) {
    var note = prompt(status === 'approved' ? 'Optional approval note:' : 'What needs to change?');
    if (status === 'changes_requested' && !note) return;
    var name = prompt('Type your full name to confirm:');
    if (!name) return;
    btn.disabled = true;
    api('/api/embed/' + TOKEN + '/approvals', {
      method: 'POST',
      body: JSON.stringify({ round_id: state.round && state.round.id, status: status, note: note, signed_name: name, reviewer_name: state.reviewerName || 'Client reviewer', reviewer_email: state.reviewerEmail || null }),
    })
      .then(function () { toast(status === 'approved' ? 'Approval recorded. Thank you!' : 'Change request sent to the team.'); })
      .catch(function (err) { toast(err.message || 'Could not record approval'); btn.disabled = false; });
  }

  function filteredItems() {
    return state.comments.filter(function (c) {
      if (c.parent_comment_id) return false;
      if (state.filter === 'open' && c.status === 'resolved') return false;
      if (state.filter === 'resolved' && c.status !== 'resolved') return false;
      if (state.filter === 'mine' && c.author_name !== (state.reviewerName || '')) return false;
      if (state.search) {
        var hay = ((c.title || '') + ' ' + c.content + ' ' + (c.ref || '') + ' ' + c.author_name).toLowerCase();
        if (hay.indexOf(state.search.toLowerCase()) === -1) return false;
      }
      return true;
    });
  }

  function fillList(list) {
    while (list.firstChild) list.removeChild(list.firstChild);
    var items = filteredItems();
    if (!items.length) {
      var empty = el('div', 'ctx-empty');
      empty.innerHTML = '<div style="font-size:28px;margin-bottom:8px">💬</div>No feedback here yet.<br>Click <b>＋ Feedback</b>, pick an element or draw a region,<br>and leave the first comment.';
      list.appendChild(empty);
      return;
    }
    items.forEach(function (f) {
      var item = el('div', 'ctx-item');
      var top = el('div', 'ctx-item-top');
      top.appendChild(el('span', 'ctx-num', f.ref || '?'));
      top.appendChild(statusBadge(f.status));
      var area = el('span', 'ctx-meta', elementLabel(f));
      area.style.cssText = 'margin:0 0 0 auto;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      top.appendChild(area);
      item.appendChild(top);
      item.appendChild(el('div', 'ctx-item-title', f.title || f.content));
      item.appendChild(el('div', 'ctx-text', f.content));
      var meta = el('div', 'ctx-meta', esc(f.author_name) + ' · ' + relTime(f.created_at) + (f.replies && f.replies.length ? ' · ' + f.replies.length + ' repl' + (f.replies.length === 1 ? 'y' : 'ies') : ''));
      item.appendChild(meta);
      item.addEventListener('click', function () {
        state.activeThreadId = f.id;
        showHighlight(f);
        renderThreadDetail(f);
      });
      list.appendChild(item);
    });
  }

  function renderList() {
    var list = panelEl && panelEl._list;
    if (!list) return;
    fillList(list);
  }

  // ------------------------------------------------------------------
  // Thread detail
  // ------------------------------------------------------------------
  function renderThreadDetail(thread) {
    if (panelEl) panelEl.remove();
    panelEl = el('div', 'ctx-detail');
    fitPanel();

    var head = el('div', 'ctx-head');
    var back = el('button', 'ctx-btn ctx-btn-ghost', '←');
    back.addEventListener('click', function () { state.activeThreadId = null; hide(highlight); renderPanel(); });
    head.appendChild(back);
    var tw = el('div');
    tw.style.cssText = 'flex:1;min-width:0;';
    tw.appendChild(el('div', 'ctx-title', (thread.ref ? thread.ref + ' · ' : '') + (thread.title || 'Feedback')));
    tw.appendChild(el('div', 'ctx-sub', elementLabel(thread)));
    head.appendChild(tw);
    head.appendChild(statusBadge(thread.status));
    panelEl.appendChild(head);

    var list = el('div', 'ctx-list');
    list.appendChild(msg(thread));
    (thread.replies || []).forEach(function (r) { list.appendChild(msg(r)); });
    panelEl.appendChild(list);

    function msg(m) {
      var d = el('div', 'ctx-msg');
      var h = el('div', 'ctx-msg-head');
      h.appendChild(el('span', null, esc(m.author_name)));
      h.appendChild(el('span', 'ctx-msg-time', relTime(m.created_at)));
      d.appendChild(h);
      d.appendChild(el('div', 'ctx-msg-body', esc(m.content)));
      return d;
    }

    var replyWrap = el('div');
    replyWrap.style.cssText = 'padding:12px 14px;border-top:1px solid #e2e8f0;display:flex;flex-direction:column;gap:8px;';
    var ta = el('textarea', 'ctx-input');
    ta.rows = 2;
    ta.placeholder = 'Write a reply…';
    var send = el('button', 'ctx-btn ctx-btn-primary', 'Send reply');
    send.style.alignSelf = 'flex-end';
    replyWrap.appendChild(ta);
    replyWrap.appendChild(send);
    panelEl.appendChild(replyWrap);
    layer.appendChild(panelEl);
    ta.focus();

    send.addEventListener('click', function () {
      var text = ta.value.trim();
      if (!text) return;
      send.disabled = true;
      api('/api/embed/' + TOKEN + '/comments/' + thread.id + '/replies', {
        method: 'POST',
        body: JSON.stringify({ content: text, author_name: state.reviewerName || 'Guest reviewer' }),
      })
        .then(function () { return refreshComments(); })
        .then(function () {
          var t = state.comments.filter(function (c) { return c.id === thread.id; })[0];
          if (t) renderThreadDetail(t);
        })
        .catch(function (err) { toast(err.message || 'Could not send reply'); send.disabled = false; });
    });
  }

  // ------------------------------------------------------------------
  // FAB / toast
  // ------------------------------------------------------------------
  var fabEl = null;
  function removeFab() {
    if (fabEl) fabEl.remove();
    fabEl = null;
  }
  function renderFab() {
    removeFab();
    if (panelEl) { panelEl.remove(); panelEl = null; }
    fabEl = el('button', 'ctx-fab');
    fabEl.innerHTML = '💬';
    fabEl.title = 'Open feedback panel';
    var open = state.comments.filter(function (c) { return !c.parent_comment_id && c.status !== 'resolved'; }).length;
    if (open) {
      var badge = el('span', 'ctx-fab-count', String(open));
      fabEl.appendChild(badge);
    }
    fabEl.addEventListener('click', function () {
      state.collapsed = false;
      localStorage.setItem('ctx:collapsed', '0');
      renderPanel();
    });
    layer.appendChild(fabEl);
  }

  function toast(text) {
    var t = el('div', 'ctx-toast', esc(text));
    layer.appendChild(t);
    setTimeout(function () { t.remove(); }, 3000);
  }

  function esc(s) { return String(s == null ? '' : s); }

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------
  api('/api/embed/' + TOKEN + '/meta' + (ROUND_ID ? '?round_id=' + encodeURIComponent(ROUND_ID) : ''))
    .then(function (data) {
      state.projectName = data.project.name;
      state.round = data.round;
      state.version = data.version;
    })
    .catch(function (err) {
      console.warn('[Contextly] embed disabled:', err.message);
      var bubble = el('div', 'ctx-toast', '⚠ Contextly embed: ' + err.message);
      bubble.style.cssText += 'position:fixed;top:16px;left:50%;transform:translateX(-50%);bottom:auto;background:#b91c1c;z-index:2147483003;';
      var dismiss = el('button', null, '×');
      dismiss.style.cssText = 'color:#fff;font-weight:700;margin-left:10px;font-size:14px;';
      dismiss.addEventListener('click', function () { host.remove(); });
      bubble.appendChild(dismiss);
      layer.appendChild(bubble);
      return 'error';
    })
    .then(function (failed) {
      if (failed === 'error' || !host.isConnected) return;
      renderPanel();
      refreshComments()
        .then(startPolling)
        .catch(function (err) { console.warn('[Contextly] could not load comments:', err.message); });
    });
})();
