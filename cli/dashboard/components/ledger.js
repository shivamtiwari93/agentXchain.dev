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

function renderFilterBar(ledger, filter) {
  const selectedAgent = filter.agent || 'all';
  const selectedPhase = filter.phase || 'all';
  const dateFrom = filter.dateFrom || '';
  const dateTo = filter.dateTo || '';
  const query = filter.query || '';
  const agents = collectAgents(ledger);
  const phases = collectPhases(ledger);

  return `<div class="filter-bar">
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
  </div>`;
}

function renderLedgerTable(entries, filter) {
  const filtered = filterEntries(entries, filter);
  let html = `<table class="data-table">
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

  html += `</tbody></table>`;
  return { html, filteredCount: filtered.length };
}

function renderRepoDecisionSummary(summary) {
  if (!summary) return '';

  const operatorSummary = summary.operator_summary || {};
  const categories = Array.isArray(operatorSummary.active_categories) && operatorSummary.active_categories.length > 0
    ? operatorSummary.active_categories.join(', ')
    : 'none active';
  const highestAuthority = typeof operatorSummary.highest_active_authority_level === 'number'
    ? `${operatorSummary.highest_active_authority_level} (${operatorSummary.highest_active_authority_role || 'unknown'})`
    : '—';
  const lineage = `${operatorSummary.superseding_active_count || 0} active superseding earlier decision${operatorSummary.superseding_active_count === 1 ? '' : 's'} · ${operatorSummary.overridden_with_successor_count || 0} overridden with recorded successor${operatorSummary.overridden_with_successor_count === 1 ? '' : 's'}`;

  return `<div class="section">
    <h3>Repo Decision Carryover</h3>
    <p class="section-subtitle">Cross-run repo-level decisions that remain binding outside the turn ledger</p>
    <div class="run-meta">
      <span class="turn-count">${summary.active_count || 0} active</span>
      <span class="badge">${summary.overridden_count || 0} overridden</span>
      <span class="badge">categories: ${esc(categories)}</span>
      <span class="badge">highest authority: ${esc(highestAuthority)}</span>
      <span class="badge">${esc(lineage)}</span>
    </div>
  </div>`;
}

function buildSections({ ledger, coordinatorLedger, state, coordinatorState }) {
  const sections = [];
  const hasRepoContext = Boolean(state) || (Array.isArray(ledger) && ledger.length > 0);
  const hasCoordinatorContext = Boolean(coordinatorState) || (Array.isArray(coordinatorLedger) && coordinatorLedger.length > 0);

  if (hasRepoContext) {
    sections.push({
      title: hasCoordinatorContext ? 'Repo Decision Ledger' : 'Decision Ledger',
      entries: Array.isArray(ledger) ? ledger : [],
      emptyMessage: 'No repo-local decisions recorded yet.',
    });
  }

  if (hasCoordinatorContext) {
    sections.push({
      title: hasRepoContext ? 'Coordinator Decision Ledger' : 'Coordinator Decision Ledger',
      entries: Array.isArray(coordinatorLedger) ? coordinatorLedger : [],
      emptyMessage: 'No coordinator decisions recorded yet.',
    });
  }

  return sections;
}

export function render({
  ledger,
  coordinatorLedger = null,
  repoDecisionsSummary = null,
  state = null,
  coordinatorState = null,
  filter = {},
}) {
  const sections = buildSections({ ledger, coordinatorLedger, state, coordinatorState });
  if (sections.length === 0) {
    return `<div class="placeholder"><h2>Decision Ledger</h2><p>No decisions recorded yet.</p></div>`;
  }

  const combinedLedger = sections.flatMap((section) => section.entries);
  let html = `<div class="ledger-view">
    <div class="section"><h3>Decisions</h3>
    <p class="section-subtitle">${sections.length === 1 ? 'Decision ledger surface' : 'Repo-local and coordinator decision ledgers'}</p>
    ${renderFilterBar(combinedLedger, filter)}
    </div>`;

  html += renderRepoDecisionSummary(repoDecisionsSummary);

  for (const section of sections) {
    const { html: tableHtml, filteredCount } = renderLedgerTable(section.entries, filter);
    html += `<div class="section"><h3>${section.title}</h3>
      <p class="section-subtitle">${filteredCount} of ${section.entries.length} decision${section.entries.length !== 1 ? 's' : ''} shown</p>`;
    if (section.entries.length === 0) {
      html += `<div class="placeholder compact"><p>${section.emptyMessage}</p></div>`;
    } else {
      html += tableHtml;
    }
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}
