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

  return ledger.filter((entry) => {
    const entryAgent = String(entry.agent || entry.role || '').trim().toLowerCase();
    const decision = String(entry.decision || entry.summary || '').trim().toLowerCase();

    if (agent !== 'all' && entryAgent !== agent) {
      return false;
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

export function render({ ledger, filter = {} }) {
  if (!ledger || ledger.length === 0) {
    return `<div class="placeholder"><h2>Decision Ledger</h2><p>No decisions recorded yet.</p></div>`;
  }

  const filtered = filterEntries(ledger, filter);
  const selectedAgent = filter.agent || 'all';
  const query = filter.query || '';
  const agents = collectAgents(ledger);

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
        <span>Search</span>
        <input
          type="search"
          data-view-control="ledger-query"
          value="${esc(query)}"
          placeholder="Filter by role or decision"
          autocomplete="off"
        >
      </label>
    </div>
    <table class="data-table">
      <thead><tr><th>Turn</th><th>Agent</th><th>Decision</th></tr></thead>
      <tbody>`;

  if (filtered.length === 0) {
    html += `<tr><td colspan="3">No decisions match the current filters.</td></tr>`;
  } else {
    for (const entry of filtered) {
      html += `<tr>
        <td class="mono">${esc(String(entry.turn ?? entry.turn_id ?? ''))}</td>
        <td>${esc(entry.agent || entry.role || '')}</td>
        <td>${esc(entry.decision || entry.summary || '')}</td>
      </tr>`;
    }
  }

  html += `</tbody></table></div></div>`;
  return html;
}
