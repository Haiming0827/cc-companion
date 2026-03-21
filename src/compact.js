// Compact mode (Dynamic Island) script

let snapshot = null;
let lastCompactHeight = 0;
let selectedPid = null;

function formatTime(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sc = s % 60;
  if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(sc).padStart(2, '0');
  return String(m).padStart(2, '0') + ':' + String(sc).padStart(2, '0');
}

function getCtxLimit(model) {
  if (!model) return 200000;
  if (model.toLowerCase().includes('opus')) return 1000000;
  return 200000;
}

function formatMem(kb) {
  if (kb >= 1048576) return (kb / 1048576).toFixed(1) + 'G';
  if (kb >= 1024) return (kb / 1024).toFixed(0) + 'M';
  return kb + 'K';
}

function render() {
  const summary = document.getElementById('compactSummary');
  const list = document.getElementById('compactInstances');
  const icon = document.getElementById('claudeIcon');

  if (!snapshot || snapshot.count === 0) {
    summary.textContent = 'no instances';
    list.innerHTML = '<div class="ci-empty">waiting for Claude Code…</div>';
    icon.classList.remove('active');
    return;
  }

  const total = snapshot.count;
  const working = snapshot.totalActive || 0;
  summary.textContent = working > 0
    ? `${total} total · ${working} working`
    : `${total} total · all ready`;

  // Pulse icon when active
  if (working > 0) {
    icon.classList.add('active');
  } else {
    icon.classList.remove('active');
  }

  // Auto-resize compact window to fit content (only if height changed)
  requestAnimationFrame(() => {
    const bar = document.getElementById('compactBar');
    if (bar && window.api) {
      const h = bar.offsetHeight + 4;
      if (h !== lastCompactHeight) {
        lastCompactHeight = h;
        window.api.resizeCompact(h);
      }
    }
  });

  // Claude icon — WORKING: warm orange, focused dot eyes, determined smile, sparkle
  const workingIcon = `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
    <!-- body -->
    <rect x="3" y="4" width="20" height="15" rx="3" fill="#e8590c"/>
    <!-- focused dot eyes -->
    <circle cx="9" cy="10" r="2" fill="#1a1a1a"/>
    <circle cx="17" cy="10" r="2" fill="#1a1a1a"/>
    <!-- small highlight in eyes -->
    <circle cx="9.7" cy="9.3" r="0.7" fill="rgba(255,255,255,0.6)"/>
    <circle cx="17.7" cy="9.3" r="0.7" fill="rgba(255,255,255,0.6)"/>
    <!-- determined smile -->
    <path d="M9.5 14.5 Q13 17 16.5 14.5" stroke="#1a1a1a" stroke-width="1.2" stroke-linecap="round" fill="none"/>
    <!-- sparkle -->
    <line x1="24.5" y1="5" x2="24.5" y2="9" stroke="#f4a82a" stroke-width="1" stroke-linecap="round"/>
    <line x1="22.5" y1="7" x2="26.5" y2="7" stroke="#f4a82a" stroke-width="1" stroke-linecap="round"/>
    <!-- legs -->
    <rect x="5" y="19" width="3" height="5" rx="0.5" fill="#e8590c"/>
    <rect x="11.5" y="19" width="3" height="5" rx="0.5" fill="#e8590c"/>
    <rect x="18" y="19" width="3" height="5" rx="0.5" fill="#e8590c"/>
  </svg>`;
  // Claude icon — SLEEPING: muted purple-grey, closed eyes, zzz bubble, tucked legs
  const sleepingIcon = `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
    <!-- body (muted, desaturated) -->
    <rect x="3" y="6" width="20" height="15" rx="3" fill="#7a6e6a" opacity="0.6"/>
    <!-- closed eyes (curved lines) -->
    <path d="M7 12 Q9 9.5 11 12" stroke="#1a1a1a" stroke-width="1.5" stroke-linecap="round" fill="none"/>
    <path d="M15 12 Q17 9.5 19 12" stroke="#1a1a1a" stroke-width="1.5" stroke-linecap="round" fill="none"/>
    <!-- little smile -->
    <path d="M10.5 16 Q13 18 15.5 16" stroke="#1a1a1a" stroke-width="1" stroke-linecap="round" fill="none"/>
    <!-- zzz bubble -->
    <text x="22" y="8" font-size="6" font-weight="900" fill="rgba(255,255,255,0.5)" font-family="sans-serif">Z</text>
    <text x="24.5" y="4.5" font-size="4.5" font-weight="900" fill="rgba(255,255,255,0.35)" font-family="sans-serif">z</text>
    <text x="26" y="2" font-size="3" font-weight="900" fill="rgba(255,255,255,0.2)" font-family="sans-serif">z</text>
    <!-- legs (tucked / resting) -->
    <rect x="5" y="21" width="3" height="3.5" rx="0.5" fill="#7a6e6a" opacity="0.5"/>
    <rect x="11.5" y="21" width="3" height="3.5" rx="0.5" fill="#7a6e6a" opacity="0.5"/>
    <rect x="18" y="21" width="3" height="3.5" rx="0.5" fill="#7a6e6a" opacity="0.5"/>
  </svg>`;

  // Only make scrollable when more than 4 instances (2 rows)
  if (snapshot.instances.length > 4) {
    list.classList.add('scrollable');
  } else {
    list.classList.remove('scrollable');
  }

  list.innerHTML = snapshot.instances.map(inst => {
    const sc = inst.active ? 'active' : 'idle';
    let durText = '';
    if (inst.active && inst.activeStart) {
      durText = formatTime(Math.floor((Date.now() - inst.activeStart) / 1000));
    }
    const modelStr = inst.model ? inst.model.replace(/^claude-/, '').split('-2')[0] : '';
    const ctxLimit = getCtxLimit(inst.model);
    const ctxPct = inst.contextTokens > 0 ? Math.min(100, (inst.contextTokens / ctxLimit) * 100) : 0;
    const ctxLabel = ctxLimit >= 1000000 ? '1M' : '200k';
    const ctxClass = ctxPct > 80 ? 'ci-ctx hot' : ctxPct > 50 ? 'ci-ctx warm' : 'ci-ctx';
    const ctxHtml = ctxPct > 0 ? `<span class="${ctxClass}" title="${Math.round(inst.contextTokens/1000)}k / ${ctxLabel}">usage ${ctxPct.toFixed(0)}%</span>` : '';
    const statusLabel = sc === 'active' ? (durText || 'working') : 'ready';
    const iconSvg = sc === 'active' ? workingIcon : sleepingIcon;

    const selClass = inst.pid === selectedPid ? ' selected' : '';
    return `<div class="ci-tile ${sc}${selClass}" data-pid="${inst.pid}">
      <div class="ci-top">
        <div class="ci-icon">${iconSvg}</div>
        <div class="ci-project">${inst.project}</div>
      </div>
      <div class="ci-bottom">
        <span class="ci-label">${statusLabel}</span>
        <span class="ci-model">${modelStr}</span>
        ${ctxHtml}
      </div>
    </div>`;
  }).join('');

  // Attach tile click handlers
  list.querySelectorAll('.ci-tile').forEach(tile => {
    tile.addEventListener('click', (e) => {
      e.stopPropagation();
      const pid = parseInt(tile.dataset.pid);
      if (selectedPid === pid) {
        selectedPid = null;
      } else {
        selectedPid = pid;
      }
      render();
    });
  });

  // Render detail panel for selected instance
  renderDetail();
}

function formatTokens(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(0) + 'k';
  return String(n);
}

function renderDetail() {
  const panel = document.getElementById('detailPanel');

  if (!selectedPid || !snapshot) {
    panel.classList.remove('visible');
    panel.innerHTML = '';
      return;
  }

  const inst = snapshot.instances.find(i => i.pid === selectedPid);
  if (!inst) {
    selectedPid = null;
    panel.classList.remove('visible');
    panel.innerHTML = '';
    return;
  }

  panel.classList.add('visible');

  const modelStr = inst.model ? inst.model.replace(/^claude-/, '').split('-2')[0] : '—';
  const ctxLimit = getCtxLimit(inst.model);
  const ctxPct = inst.contextTokens > 0 ? Math.min(100, (inst.contextTokens / ctxLimit) * 100) : 0;
  const branch = inst.gitBranch || '—';
  const shortCwd = inst.cwd ? inst.cwd.replace(/^\/Users\/[^/]+/, '~') : '—';

  panel.innerHTML = `
    <div class="detail-header">
      <span class="detail-title">${inst.project}</span>
      <button class="detail-close no-drag" id="detailClose">✕</button>
    </div>
    <div class="detail-grid">
      <div class="detail-row"><span class="detail-key">model</span><span class="detail-val">${modelStr}</span></div>
      <div class="detail-row"><span class="detail-key">branch</span><span class="detail-val">${branch}</span></div>
      <div class="detail-row"><span class="detail-key">turns</span><span class="detail-val">${inst.turnCount}</span></div>
      <div class="detail-row"><span class="detail-key">context</span><span class="detail-val">${ctxPct.toFixed(0)}%</span></div>
      <div class="detail-row"><span class="detail-key">in tokens</span><span class="detail-val">${formatTokens(inst.inputTokens)}</span></div>
      <div class="detail-row"><span class="detail-key">out tokens</span><span class="detail-val">${formatTokens(inst.outputTokens)}</span></div>
      <div class="detail-row"><span class="detail-key">cached</span><span class="detail-val">${formatTokens(inst.cacheReadTokens)}</span></div>
      <div class="detail-row"><span class="detail-key">cpu / mem</span><span class="detail-val">${inst.cpu.toFixed(1)}% / ${formatMem(inst.rss)}</span></div>
    </div>
    <div class="detail-path" title="${inst.cwd}">${shortCwd}</div>
    <button class="detail-focus-btn no-drag" id="detailFocusBtn">Open instance</button>
  `;

  document.getElementById('detailClose').addEventListener('click', (e) => {
    e.stopPropagation();
    selectedPid = null;
    render();
  });

  document.getElementById('detailFocusBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (window.api) window.api.focusInstance(inst.pid);
  });
}

// ── Drag to move ──────────────────────────────────────────────
let dragging = false;
let dragStartX = 0, dragStartY = 0;

document.addEventListener('mousedown', (e) => {
  if (e.target.closest('.no-drag')) return;
  dragging = true;
  dragStartX = e.screenX;
  dragStartY = e.screenY;
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const dx = e.screenX - dragStartX;
  const dy = e.screenY - dragStartY;
  dragStartX = e.screenX;
  dragStartY = e.screenY;
  if (window.api) window.api.moveCompactWindow(dx, dy);
});

document.addEventListener('mouseup', (e) => {
  if (!dragging) return;
  dragging = false;
});

// ── Click: snap button ────────────────────────────────────────
document.getElementById('snapBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  if (window.api) window.api.snapCompactWindow();
});

// ── Click: expand → open full app ─────────────────────────────
document.getElementById('expandBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  if (window.api) window.api.toggleCompact();
});

// ── Click: minimize → hide to dock ───────────────────────────
document.getElementById('minimizeBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  if (window.api) window.api.hideCompact();
});

// ── Click: snap → top center ─────────────────────────────────

// ── Data & refresh ────────────────────────────────────────────
window.api.onClaudeInstances((data) => { snapshot = data; render(); });
setInterval(() => { if (snapshot && snapshot.count > 0) render(); }, 1000);
