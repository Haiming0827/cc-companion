// Compact mode (Dynamic Island) script

let snapshot = null;
let lastCompactHeight = 0;

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

  list.innerHTML = snapshot.instances.map(inst => {
    const sc = inst.active ? 'active' : 'idle';
    let durText = '';
    if (inst.active && inst.activeStart) {
      durText = formatTime(Math.floor((Date.now() - inst.activeStart) / 1000));
    } else if (!inst.active && inst.idleStart) {
      durText = formatTime(Math.floor((Date.now() - inst.idleStart) / 1000));
    }
    const memText = inst.rss ? ' · ' + formatMem(inst.rss) : '';
    const cpuText = inst.cpu.toFixed(1) + '%';
    const modelStr = inst.model ? inst.model.replace(/^claude-/, '').split('-2')[0] : '';
    // Context usage — adapt limit to model
    const ctxLimit = getCtxLimit(inst.model);
    const ctxPct = inst.contextTokens > 0 ? Math.min(100, (inst.contextTokens / ctxLimit) * 100) : 0;
    const ctxLabel = ctxLimit >= 1000000 ? '1M' : '200k';
    const ctxClass = ctxPct > 80 ? 'ci-ctx hot' : ctxPct > 50 ? 'ci-ctx warm' : 'ci-ctx';
    const ctxHtml = ctxPct > 0 ? `<span class="${ctxClass}" title="${Math.round(inst.contextTokens/1000)}k / ${ctxLabel}">${ctxPct.toFixed(0)}%</span>` : '';

    // Model + ctx% grouped together
    const metaHtml = (modelStr || ctxHtml) ? `<div class="ci-meta">${modelStr ? `<span class="ci-model">${modelStr}</span>` : ''}${ctxHtml}</div>` : '';

    return `<div class="ci-row">
      <div class="ci-dot ${sc}"></div>
      <div class="ci-project">${inst.project}</div>
      <div class="ci-right">
        ${metaHtml}
        <div class="ci-dur ${sc}">${durText}</div>
        <div class="ci-status ${sc}">${sc === 'active' ? cpuText + memText : 'ready'}</div>
      </div>
    </div>`;
  }).join('');
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

// ── Click: expand button + compact-info → open app ───────────
document.getElementById('expandBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  if (window.api) window.api.toggleCompact();
});

document.getElementById('compactInfo').addEventListener('click', (e) => {
  if (window.api) window.api.toggleCompact();
});

// Instance rows (no-drag zone) also open app on click
document.getElementById('compactInstances').addEventListener('click', () => {
  if (window.api) window.api.toggleCompact();
});

// ── Click-through for transparent areas ───────────────────────
// Default: ignore mouse on transparent parts, re-enable on content hover
if (window.api) window.api.setIgnoreMouse(true);

const bar = document.getElementById('compactBar');
bar.addEventListener('mouseenter', () => {
  if (window.api) window.api.setIgnoreMouse(false);
});
bar.addEventListener('mouseleave', () => {
  if (!dragging && window.api) window.api.setIgnoreMouse(true);
});

// ── Data & refresh ────────────────────────────────────────────
window.api.onClaudeInstances((data) => { snapshot = data; render(); });
setInterval(() => { if (snapshot && snapshot.count > 0) render(); }, 1000);
