/**
 * Decision Ledger view — renders the decision-ledger.jsonl entries.
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

export function filterEntries(ledger, filters = {}) {
  if (!Array.isArray(ledger)) return [];

  const query = String(filters.query || '').trim().toLowerCase();
  const agent = String(filters.agent || 'all').trim().toLowerCase();
  const phase = String(filters.phase || 'all').trim().toLowerCase();
  const dateFrom = filters.dateFrom || '';
  const dateTo = filters.dateTo || '';

  return ledger.filter((entry) => {
    const entryAgent = String(entry.agent || entry.role || '').trim().toLowerCase();
    const decision = String(entry.decision || entry.summary || '').trim().toLowerCase();

    if (agent !== 'all' && entryAgent !== agent) {
      return false;
    }

    if (phase !== 'all') {
      const entryPhase = String(entry.phase || '').trim().toLowerCase();
      if (entryPhase !== phase) {
        return false;
      }
    }

    if (dateFrom && entry.timestamp) {
      if (entry.timestamp < dateFrom) {
        return false;
      }
    }

    if (dateTo && entry.timestamp) {
      if (entry.timestamp > dateTo) {
        return false;
      }
    }

    if (!query) {
      return true;
    }

    return entryAgent.includes(query) || decision.includes(query);
  });
}

function collectAgents(ledger) {
  const unique = new Set();
  for (const entry of ledger) {
    const agent = entry.agent || entry.role;
    if (agent) unique.add(agent);
  }
  return Array.from(unique).sort();
}

function collectPhases(ledger) {
  const unique = new Set();
  for (const entry of ledger) {
    if (entry.phase) unique.add(entry.phase);
  }
  return Array.from(unique).sort();
}

function hasObjections(entry) {
  return Array.isArray(entry.objections) && entry.objections.length > 0;
}

export function render({ ledger, filter = {} }) {
  if (!ledger || ledger.length === 0) {
    return `<div class="placeholder"><h2>Decision Ledger</h2><p>No decisions recorded yet.</p></div>`;
  }

  const filtered = filterEntries(ledger, filter);
  const selectedAgent = filter.agent || 'all';
  const selectedPhase = filter.phase || 'all';
  const dateFrom = filter.dateFrom || '';
  const dateTo = filter.dateTo || '';
  const query = filter.query || '';
  const agents = collectAgents(ledger);
  const phases = collectPhases(ledger);

  let html = `<div class="ledger-view">
    <div class="section"><h3>Decision Ledger</h3>
    <p class="section-subtitle">${filtered.length} of ${ledger.length} decision${ledger.length !== 1 ? 's' : ''} shown</p>
    <div class="filter-bar">
      <label class="filter-control">
        <span>Agent</span>
        <select data-view-control="ledger-agent">
          <option value="all"${selectedAgent === 'all' ? ' selected' : ''}>All roles</option>
          ${agents.map((agent) => `<option value="${esc(agent)}"${selectedAgent === agent ? ' selected' : ''}>${esc(agent)}</option>`).join('')}
        </select>
      </label>
      <label class="filter-control">
        <span>Phase</span>
        <select data-view-control="ledger-phase">
          <option value="all"${selectedPhase === 'all' ? ' selected' : ''}>All phases</option>
          ${phases.map((p) => `<option value="${esc(p)}"${selectedPhase === p ? ' selected' : ''}>${esc(p)}</option>`).join('')}
        </select>
      </label>
      <label class="filter-control">
        <span>Search</span>
        <input
          type="search"
          data-view-control="ledger-query"
          value="${esc(query)}"
          placeholder="Filter by role or decision"
          autocomplete="off"
        >
      </label>
      <label class="filter-control">
        <span>From</span>
        <input
          type="date"
          data-view-control="ledger-date-from"
          value="${esc(dateFrom)}"
          autocomplete="off"
        >
      </label>
      <label class="filter-control">
        <span>To</span>
        <input
          type="date"
          data-view-control="ledger-date-to"
          value="${esc(dateTo)}"
          autocomplete="off"
        >
      </label>
    </div>
    <table class="data-table">
      <thead><tr><th>Turn</th><th>Agent</th><th>Decision</th><th>Timestamp</th></tr></thead>
      <tbody>`;

  if (filtered.length === 0) {
    html += `<tr><td colspan="4">No decisions match the current filters.</td></tr>`;
  } else {
    for (const entry of filtered) {
      const objectionBadge = hasObjections(entry)
        ? ' <span class="objection-badge">objection</span>'
        : '';
      html += `<tr>
        <td class="mono">${esc(String(entry.turn ?? entry.turn_id ?? ''))}</td>
        <td>${esc(entry.agent || entry.role || '')}${objectionBadge}</td>
        <td>${esc(entry.decision || entry.summary || '')}</td>
        <td class="mono">${esc(entry.timestamp || '')}</td>
      </tr>`;
    }
  }

  html += `</tbody></table></div></div>`;
  return html;
}
