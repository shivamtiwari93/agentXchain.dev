function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function badgeTone(state) {
  switch (state) {
    case 'live':
      return 'var(--green)';
    case 'stale':
      return 'var(--yellow)';
    case 'disconnected':
      return 'var(--red)';
    default:
      return 'var(--text-dim)';
  }
}

export function renderLiveStatus(liveMeta) {
  if (!liveMeta) return '';

  const tone = badgeTone(liveMeta.freshness_state);
  return `<div class="live-status-banner live-status-${esc(liveMeta.freshness_state)}">
    <div class="turn-header">
      <strong>${esc(liveMeta.title || 'Live Feed')}</strong>
      <span class="badge" style="color:${tone};border-color:${tone}">${esc(liveMeta.freshness_label || 'Unknown')}</span>
    </div>
    <div class="live-status-grid">
      <span><strong>Freshness:</strong> ${esc(liveMeta.refresh_detail || 'unknown')}</span>
      <span><strong>Connection:</strong> ${esc(liveMeta.connection_detail || 'unknown')}</span>
      <span><strong>Event:</strong> ${esc(liveMeta.event_detail || 'unknown')}</span>
    </div>
  </div>`;
}
