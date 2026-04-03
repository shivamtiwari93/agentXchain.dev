/**
 * Hook Audit view — renders hook-audit.jsonl entries.
 *
 * Pure render function: takes data, returns HTML string. Testable in Node.js.
 */

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getHookPhase(entry) {
  return entry?.hook_phase || entry?.phase || '';
}

function getHookName(entry) {
  return entry?.hook_name || entry?.hook || entry?.name || '';
}

function formatAnnotations(entry) {
  if (Array.isArray(entry?.annotations) && entry.annotations.length > 0) {
    return entry.annotations
      .map((annotation) => annotation && typeof annotation === 'object'
        ? `${annotation.key}: ${annotation.value}`
        : null)
      .filter(Boolean)
      .join(', ');
  }

  return entry?.annotation || entry?.message || '';
}

function verdictBadge(verdict) {
  const colors = {
    allow: 'var(--green)',
    warn: 'var(--yellow)',
    block: 'var(--red)',
  };
  const color = colors[verdict] || 'var(--text-dim)';
  return `<span class="badge" style="color:${color};border-color:${color}">${esc(verdict)}</span>`;
}

export function filterAudit(audit, filters = {}) {
  if (!Array.isArray(audit)) return [];

  const phase = String(filters.phase || 'all').trim().toLowerCase();
  const verdict = String(filters.verdict || 'all').trim().toLowerCase();
  const hookName = String(filters.hookName || 'all').trim().toLowerCase();

  return audit.filter((entry) => {
    if (phase !== 'all') {
      const entryPhase = String(getHookPhase(entry)).trim().toLowerCase();
      if (entryPhase !== phase) return false;
    }

    if (verdict !== 'all') {
      const entryVerdict = String(entry.verdict || '').trim().toLowerCase();
      if (entryVerdict !== verdict) return false;
    }

    if (hookName !== 'all') {
      const entryHookName = String(getHookName(entry)).trim().toLowerCase();
      if (entryHookName !== hookName) return false;
    }

    return true;
  });
}

function collectHookPhases(audit) {
  const unique = new Set();
  for (const entry of audit) {
    const phase = getHookPhase(entry);
    if (phase) unique.add(phase);
  }
  return Array.from(unique).sort();
}

function collectHookNames(audit) {
  const unique = new Set();
  for (const entry of audit) {
    const name = getHookName(entry);
    if (name) unique.add(name);
  }
  return Array.from(unique).sort();
}

export function render({ audit, annotations, filter = {} }) {
  const hasAudit = Array.isArray(audit) && audit.length > 0;
  const hasAnnotations = Array.isArray(annotations) && annotations.length > 0;

  if (!hasAudit && !hasAnnotations) {
    return `<div class="placeholder"><h2>Hook Audit</h2><p>No hook activity recorded.</p></div>`;
  }

  let html = `<div class="hooks-view">`;

  if (hasAudit) {
    const filtered = filterAudit(audit, filter);
    const phases = collectHookPhases(audit);
    const hookNames = collectHookNames(audit);
    const selectedPhase = filter.phase || 'all';
    const selectedVerdict = filter.verdict || 'all';
    const selectedHookName = filter.hookName || 'all';

    html += `<div class="section"><h3>Hook Audit Log</h3>
      <p class="section-subtitle">${filtered.length} of ${audit.length} hook execution${audit.length !== 1 ? 's' : ''}</p>
      <div class="filter-bar">
        <label class="filter-control">
          <span>Phase</span>
          <select data-view-control="hooks-phase">
            <option value="all"${selectedPhase === 'all' ? ' selected' : ''}>All phases</option>
            ${phases.map((p) => `<option value="${esc(p)}"${selectedPhase === p ? ' selected' : ''}>${esc(p)}</option>`).join('')}
          </select>
        </label>
        <label class="filter-control">
          <span>Verdict</span>
          <select data-view-control="hooks-verdict">
            <option value="all"${selectedVerdict === 'all' ? ' selected' : ''}>All verdicts</option>
            <option value="allow"${selectedVerdict === 'allow' ? ' selected' : ''}>allow</option>
            <option value="warn"${selectedVerdict === 'warn' ? ' selected' : ''}>warn</option>
            <option value="block"${selectedVerdict === 'block' ? ' selected' : ''}>block</option>
          </select>
        </label>
        <label class="filter-control">
          <span>Hook</span>
          <select data-view-control="hooks-hookname">
            <option value="all"${selectedHookName === 'all' ? ' selected' : ''}>All hooks</option>
            ${hookNames.map((n) => `<option value="${esc(n)}"${selectedHookName === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}
          </select>
        </label>
      </div>
      <table class="data-table">
        <thead><tr><th>Time</th><th>Phase</th><th>Hook</th><th>Verdict</th><th>Action</th><th>Duration</th></tr></thead>
        <tbody>`;

    for (const entry of filtered) {
      const duration = entry.duration_ms != null ? `${entry.duration_ms}ms` : '-';
      const action = entry.orchestrator_action || entry.action || 'continued';
      html += `<tr>
        <td class="mono">${esc(entry.timestamp || '-')}</td>
        <td class="mono">${esc(getHookPhase(entry))}</td>
        <td>${esc(getHookName(entry))}</td>
        <td>${verdictBadge(entry.verdict)}</td>
        <td class="mono">${esc(action)}</td>
        <td class="mono">${esc(duration)}</td>
      </tr>`;
    }

    html += `</tbody></table></div>`;
  }

  if (hasAnnotations) {
    html += `<div class="section"><h3>Hook Annotations</h3>
      <p class="section-subtitle">${annotations.length} annotation${annotations.length !== 1 ? 's' : ''}</p>
      <div class="annotation-list">`;

    for (const entry of annotations) {
      const annotationText = formatAnnotations(entry);
      html += `<div class="annotation-card">
        <span class="mono">${esc(entry.turn_id || '-')}</span>
        <span class="mono">${esc(getHookName(entry))}</span>
        <span>${esc(annotationText || JSON.stringify(entry))}</span>
      </div>`;
    }

    html += `</div></div>`;
  }

  html += `</div>`;
  return html;
}
