/**
 * Workflow-Kit Artifacts view — renders live workflow-kit artifact status.
 *
 * Pure render function: takes data from /api/workflow-kit-artifacts, returns HTML.
 * Ownership resolution and file-existence checks are server-side. This view
 * renders the snapshot without reimplementing any logic.
 *
 * See: WORKFLOW_KIT_DASHBOARD_SPEC.md
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

function badge(label, color = 'var(--text-dim)') {
  return `<span class="badge" style="color:${color};border-color:${color}">${esc(label)}</span>`;
}

function statusIndicator(exists) {
  if (exists) {
    return `<span style="color:var(--green);font-weight:600" title="File exists">✓ exists</span>`;
  }
  return `<span style="color:var(--red);font-weight:600" title="File missing">✗ missing</span>`;
}

function renderArtifactRow(artifact) {
  const isMissingRequired = !artifact.exists && artifact.required;
  const rowStyle = isMissingRequired
    ? ' style="border-left:3px solid var(--red)"'
    : '';

  return `<tr${rowStyle}>
    <td class="mono">${esc(artifact.path)}</td>
    <td>${artifact.required ? badge('required', 'var(--yellow)') : badge('optional', 'var(--text-dim)')}</td>
    <td>${artifact.semantics ? `<span class="mono">${esc(artifact.semantics)}</span>` : '<span style="color:var(--text-dim)">—</span>'}</td>
    <td>${artifact.owned_by ? esc(artifact.owned_by) : '<span style="color:var(--text-dim)">—</span>'}</td>
    <td>${artifact.owner_resolution ? badge(artifact.owner_resolution, artifact.owner_resolution === 'explicit' ? 'var(--accent)' : 'var(--text-dim)') : '—'}</td>
    <td>${statusIndicator(artifact.exists)}</td>
  </tr>`;
}

export function render({ workflowKitArtifacts }) {
  if (!workflowKitArtifacts) {
    return `<div class="placeholder"><h2>Workflow Artifacts</h2><p>No workflow artifact data available. Ensure a governed run is active.</p></div>`;
  }

  if (workflowKitArtifacts.ok === false) {
    const hint = workflowKitArtifacts.code === 'config_missing' || workflowKitArtifacts.code === 'state_missing'
      ? ' Run <code>agentxchain init --governed</code> to get started.'
      : '';
    return `<div class="placeholder"><h2>Workflow Artifacts</h2><p>${esc(workflowKitArtifacts.error || 'Failed to load workflow artifact data.')}${hint}</p></div>`;
  }

  const data = workflowKitArtifacts;
  const artifacts = data.artifacts;

  // No workflow_kit configured
  if (artifacts === null) {
    return `<div class="placeholder"><h2>Workflow Artifacts</h2><p>No <code>workflow_kit</code> configured in <code>agentxchain.json</code>. Add a <code>workflow_kit</code> section to track phase artifacts.</p></div>`;
  }

  // Phase has no artifacts
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    return `<div class="placeholder"><h2>Workflow Artifacts</h2><p>Current phase <strong>${esc(data.phase || 'unknown')}</strong> has no workflow-kit artifacts defined.</p></div>`;
  }

  const missingRequired = artifacts.filter((a) => a.required && !a.exists).length;
  const totalExists = artifacts.filter((a) => a.exists).length;

  let html = `<div class="artifacts-view">`;

  // Header
  html += `<div class="run-header"><div class="run-meta">`;
  if (data.phase) {
    html += `<span class="phase-label">Phase: <strong>${esc(data.phase)}</strong></span>`;
  }
  html += `<span class="turn-count">${artifacts.length} artifact${artifacts.length !== 1 ? 's' : ''}</span>`;
  html += `<span class="turn-count">${totalExists}/${artifacts.length} present</span>`;
  if (missingRequired > 0) {
    html += badge(`${missingRequired} missing required`, 'var(--red)');
  }
  html += `</div></div>`;

  // Table
  html += `<div class="section"><h3>Workflow-Kit Artifacts</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>Path</th>
          <th>Required</th>
          <th>Semantics</th>
          <th>Owner</th>
          <th>Resolution</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>`;

  for (const artifact of artifacts) {
    html += renderArtifactRow(artifact);
  }

  html += `</tbody></table></div>`;

  html += `</div>`;
  return html;
}
