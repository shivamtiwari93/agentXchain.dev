function esc(str) {
  if (str == null) return '';
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

function formatResult(entry) {
  if (entry?.delivered) return badge('delivered', 'var(--green)');
  if (entry?.timed_out) return badge('timed out', 'var(--yellow)');
  return badge('failed', 'var(--red)');
}

function renderWebhookRow(webhook) {
  return `<tr>
    <td class="mono">${esc(webhook.name)}</td>
    <td>${esc(webhook.timeout_ms)}</td>
    <td>${esc(webhook.event_count)}</td>
    <td><span class="mono">${esc((webhook.events || []).join(', '))}</span></td>
  </tr>`;
}

function renderAuditRow(entry) {
  const rowStyle = entry?.delivered ? '' : ' style="border-left:3px solid var(--red)"';
  const statusCode = entry?.status_code == null ? '—' : String(entry.status_code);
  const duration = entry?.duration_ms == null ? '—' : `${entry.duration_ms}ms`;
  return `<tr${rowStyle}>
    <td class="mono">${esc(entry?.emitted_at || '—')}</td>
    <td><span class="mono">${esc(entry?.event_type || '—')}</span></td>
    <td class="mono">${esc(entry?.notification_name || '—')}</td>
    <td>${formatResult(entry)}</td>
    <td>${esc(statusCode)}</td>
    <td>${esc(duration)}</td>
    <td>${esc(entry?.message || '—')}</td>
  </tr>`;
}

export function render({ notifications }) {
  if (!notifications) {
    return `<div class="placeholder"><h2>Notifications</h2><p>No notification data available.</p></div>`;
  }

  if (notifications.ok === false) {
    const hint = notifications.code === 'config_missing'
      ? ' Run <code>agentxchain init --governed</code> to get started.'
      : '';
    return `<div class="placeholder"><h2>Notifications</h2><p>${esc(notifications.error || 'Failed to load notification data.')}${hint}</p></div>`;
  }

  const recent = Array.isArray(notifications.recent) ? notifications.recent : [];
  const webhooks = Array.isArray(notifications.webhooks) ? notifications.webhooks : [];
  const summary = notifications.summary || {};

  if (!notifications.configured && recent.length === 0) {
    return `<div class="placeholder"><h2>Notifications</h2><p>No <code>notifications.webhooks</code> are configured and no delivery audit entries exist yet.</p></div>`;
  }

  let html = `<div class="notifications-view"><div class="run-header"><div class="run-meta">`;
  html += notifications.configured
    ? badge(`${webhooks.length} webhook${webhooks.length === 1 ? '' : 's'} configured`, 'var(--green)')
    : badge('not currently configured', 'var(--yellow)');
  html += badge(`${summary.total_attempts || 0} attempts`, 'var(--accent)');
  if ((summary.failed || 0) > 0) {
    html += badge(`${summary.failed} failed`, 'var(--red)');
  }
  if ((summary.timed_out || 0) > 0) {
    html += badge(`${summary.timed_out} timed out`, 'var(--yellow)');
  }
  if (notifications.approval_sla?.enabled) {
    html += badge(`approval SLA: ${(notifications.approval_sla.reminder_after_seconds || []).join(', ')}s`, 'var(--accent)');
  }
  html += `</div></div>`;

  if (webhooks.length > 0) {
    html += `<div class="section"><h3>Notification Targets</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Timeout</th>
            <th>Events</th>
            <th>Subscribed Event Types</th>
          </tr>
        </thead>
        <tbody>${webhooks.map(renderWebhookRow).join('')}</tbody>
      </table>
    </div>`;
  }

  html += `<div class="section"><h3>Delivery Summary</h3>
    <p><strong>Delivered:</strong> ${esc(summary.delivered || 0)}<br>
    <strong>Failed:</strong> ${esc(summary.failed || 0)}<br>
    <strong>Last emitted:</strong> ${esc(summary.last_emitted_at || '—')}<br>
    <strong>Last failure:</strong> ${esc(summary.last_failure_at || '—')}</p>
  </div>`;

  if (recent.length === 0) {
    html += `<div class="section"><h3>Recent Delivery Attempts</h3><p style="color:var(--text-dim)">No notification deliveries recorded yet.</p></div>`;
  } else {
    html += `<div class="section"><h3>Recent Delivery Attempts</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>Emitted</th>
            <th>Event</th>
            <th>Target</th>
            <th>Result</th>
            <th>Status</th>
            <th>Duration</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>${recent.map(renderAuditRow).join('')}</tbody>
      </table>
    </div>`;
  }

  html += `</div>`;
  return html;
}
