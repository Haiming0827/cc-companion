// Compact mode (Dynamic Island) script

let snapshot = null;

function formatTime(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sc = s % 60;
  if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(sc).padStart(2, '0');
  return String(m).padStart(2, '0') + ':' + String(sc).padStart(2, '0');
}

function formatMem(kb) {
  if (kb >= 1048576) return (kb / 1048576).toFixed(1) + 'G';
  if (kb >= 1024) return (kb / 1024).toFixed(0) + 'M';
  return kb + 'K';
}

function render() {
  const summary = document.getElementById('compactSummary');
  const list = document.getElementById('compactInstances');

  if (!snapshot || snapshot.count === 0) {
    summary.textContent = 'no instances';
    list.innerHTML = '<div class="ci-empty">waiting for Claude Code…</div>';
    return;
  }

  const total = snapshot.count;
  const working = snapshot.totalActive || 0;
  summary.textContent = working > 0
    ? `${total} total · ${working} working`
    : `${total} total · all idle`;

  list.innerHTML = snapshot.instances.map(inst => {
    const sc = inst.active ? 'active' : 'idle';
    let durText = '';
    if (inst.active && inst.activeStart) {
      durText = formatTime(Math.floor((Date.now() - inst.activeStart) / 1000));
    } else if (!inst.active && inst.idleStart) {
      durText = 'idle ' + formatTime(Math.floor((Date.now() - inst.idleStart) / 1000));
    }
    const memText = inst.rss ? ' · ' + formatMem(inst.rss) : '';
    const cpuText = inst.cpu.toFixed(1) + '%';

    return `<div class="ci-row">
      <div class="ci-dot ${sc}"></div>
      <div class="ci-project">${inst.project}</div>
      <div class="ci-dur ${sc}">${durText}</div>
      <div class="ci-status ${sc}">${sc === 'active' ? cpuText + memText : 'idle'}</div>
    </div>`;
  }).join('');
}

window.api.onClaudeInstances((data) => { snapshot = data; render(); });
document.getElementById('compactBar').addEventListener('click', () => window.api.toggleCompact());
setInterval(() => { if (snapshot && snapshot.count > 0) render(); }, 1000);
