import http from 'node:http';
import https from 'node:https';
import process from 'node:process';

const DEFAULT_API_BASE = 'https://api.github.com';
const DEFAULT_TOKEN_ENV = 'GITHUB_TOKEN';
const DEFAULT_LABEL_PREFIX = 'agentxchain';

export async function readEnvelope() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  return input.trim() ? JSON.parse(input) : {};
}

function writeResult(result) {
  process.stdout.write(JSON.stringify(result));
}

function warn(message) {
  writeResult({ verdict: 'warn', message });
}

function ok(message) {
  writeResult({ verdict: 'allow', message });
}

function parsePluginConfig() {
  try {
    return JSON.parse(process.env.AGENTXCHAIN_PLUGIN_CONFIG || '{}');
  } catch {
    return null;
  }
}

function normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const repo = typeof raw.repo === 'string' ? raw.repo.trim() : '';
  const issueNumber = Number.isInteger(raw.issue_number) ? raw.issue_number : null;
  if (!repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || !issueNumber || issueNumber < 1) {
    return null;
  }

  const [owner, name] = repo.split('/');
  return {
    owner,
    repo: name,
    issue_number: issueNumber,
    token_env: typeof raw.token_env === 'string' && raw.token_env.trim() ? raw.token_env.trim() : DEFAULT_TOKEN_ENV,
    api_base_url: typeof raw.api_base_url === 'string' && raw.api_base_url.trim()
      ? raw.api_base_url.trim().replace(/\/+$/, '')
      : DEFAULT_API_BASE,
    label_prefix: typeof raw.label_prefix === 'string' && raw.label_prefix.trim()
      ? raw.label_prefix.trim()
      : DEFAULT_LABEL_PREFIX,
  };
}

function getToken(config) {
  return process.env[config.token_env] || '';
}

function buildHeaders(token, body) {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    'user-agent': '@agentxchain/plugin-github-issues',
    'x-github-api-version': '2022-11-28',
  };
}

async function requestJson(config, token, method, path, bodyValue) {
  const url = new URL(path, `${config.api_base_url}/`);
  const body = bodyValue === undefined ? '' : JSON.stringify(bodyValue);
  const transport = url.protocol === 'https:' ? https : http;

  const response = await new Promise((resolve, reject) => {
    const req = transport.request(url, {
      method,
      headers: buildHeaders(token, body),
      timeout: 7000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode || 500,
          body: data,
        });
      });
    });

    req.on('timeout', () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });

  let parsed = null;
  if (response.body) {
    try {
      parsed = JSON.parse(response.body);
    } catch {
      parsed = null;
    }
  }

  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    body: parsed,
    raw: response.body,
  };
}

async function listComments(config, token) {
  const comments = [];
  for (let page = 1; page <= 10; page += 1) {
    const response = await requestJson(
      config,
      token,
      'GET',
      `/repos/${config.owner}/${config.repo}/issues/${config.issue_number}/comments?per_page=100&page=${page}`,
    );

    if (!response.ok) {
      return response;
    }

    const pageItems = Array.isArray(response.body) ? response.body : [];
    comments.push(...pageItems);
    if (pageItems.length < 100) {
      break;
    }
  }

  return { ok: true, body: comments };
}

function runMarker(runId) {
  return `<!-- agentxchain:github-issues:run:${runId || 'unknown'} -->`;
}

function buildManagedLabels(config, event) {
  const labels = [config.label_prefix];
  if (event.type === 'after_acceptance' && event.phase) {
    labels.push(`${config.label_prefix}:phase:${event.phase}`);
  }
  if (event.type === 'on_escalation') {
    labels.push(`${config.label_prefix}:blocked`);
  }
  return labels;
}

function mergeLabels(existingLabels, managedLabels, labelPrefix) {
  const retained = existingLabels
    .map((entry) => (typeof entry === 'string' ? entry : entry?.name))
    .filter((name) => typeof name === 'string' && name && !name.startsWith(`${labelPrefix}:`) && name !== labelPrefix);

  return [...retained, ...managedLabels];
}

function buildAcceptanceBody(envelope) {
  const payload = envelope.payload || {};
  return [
    runMarker(envelope.run_id),
    '## AgentXchain Run Update',
    '',
    `- Run: \`${envelope.run_id || 'unknown'}\``,
    '- Event: `after_acceptance`',
    `- Status: \`${payload.run_status || 'active'}\``,
    `- Phase: \`${payload.phase || 'unknown'}\``,
    `- Latest accepted turn: \`${payload.turn_id || 'unknown'}\` (\`${payload.role_id || 'unknown'}\`)`,
    `- History index: \`${payload.history_entry_index ?? 'unknown'}\``,
    `- Decisions on latest turn: \`${payload.decisions_count ?? 0}\``,
    `- Objections on latest turn: \`${payload.objections_count ?? 0}\``,
    `- Updated: \`${envelope.timestamp || new Date().toISOString()}\``,
    '',
    'Plugin-owned comment from `@agentxchain/plugin-github-issues`.',
  ].join('\n');
}

function buildEscalationBody(envelope) {
  const payload = envelope.payload || {};
  return [
    runMarker(envelope.run_id),
    '## AgentXchain Run Update',
    '',
    `- Run: \`${envelope.run_id || 'unknown'}\``,
    '- Event: `on_escalation`',
    '- Status: `blocked`',
    `- Blocked reason: \`${payload.blocked_reason || 'unknown'}\``,
    `- Failed turn: \`${payload.failed_turn_id || 'unknown'}\` (\`${payload.failed_role || 'unknown'}\`)`,
    `- Recovery action: ${payload.recovery_action || 'unknown'}`,
    `- Last error: ${payload.last_error || 'unknown'}`,
    `- Updated: \`${envelope.timestamp || new Date().toISOString()}\``,
    '',
    'Plugin-owned comment from `@agentxchain/plugin-github-issues`.',
  ].join('\n');
}

async function upsertComment(config, token, envelope, body) {
  const comments = await listComments(config, token);
  if (!comments.ok) {
    return comments;
  }

  const marker = runMarker(envelope.run_id);
  const existing = comments.body.find((comment) => typeof comment?.body === 'string' && comment.body.includes(marker));

  if (existing) {
    return requestJson(
      config,
      token,
      'PATCH',
      `/repos/${config.owner}/${config.repo}/issues/comments/${existing.id}`,
      { body },
    );
  }

  return requestJson(
    config,
    token,
    'POST',
    `/repos/${config.owner}/${config.repo}/issues/${config.issue_number}/comments`,
    { body },
  );
}

async function syncLabels(config, token, event) {
  const issue = await requestJson(
    config,
    token,
    'GET',
    `/repos/${config.owner}/${config.repo}/issues/${config.issue_number}`,
  );
  if (!issue.ok) {
    return issue;
  }

  const labels = mergeLabels(issue.body?.labels || [], buildManagedLabels(config, event), config.label_prefix);
  return requestJson(
    config,
    token,
    'PUT',
    `/repos/${config.owner}/${config.repo}/issues/${config.issue_number}/labels`,
    { labels },
  );
}

export async function publishRunUpdate(kind) {
  try {
    const rawConfig = parsePluginConfig();
    if (rawConfig === null) {
      warn('Invalid AGENTXCHAIN_PLUGIN_CONFIG JSON');
      return;
    }

    const config = normalizeConfig(rawConfig);
    if (!config) {
      warn('Missing or invalid GitHub issue plugin config');
      return;
    }

    const token = getToken(config);
    if (!token) {
      warn(`Missing GitHub token env ${config.token_env}`);
      return;
    }

    const envelope = await readEnvelope();
    const body = kind === 'after_acceptance'
      ? buildAcceptanceBody(envelope)
      : buildEscalationBody(envelope);

    const comment = await upsertComment(config, token, envelope, body);
    if (!comment.ok) {
      warn(`GitHub comment sync failed with HTTP ${comment.status}`);
      return;
    }

    const labels = await syncLabels(config, token, {
      type: kind,
      phase: envelope.payload?.phase || null,
    });
    if (!labels.ok) {
      warn(`GitHub label sync failed with HTTP ${labels.status}`);
      return;
    }

    ok('GitHub issue updated');
  } catch (error) {
    warn(`GitHub issue sync failed: ${error.message || String(error)}`);
  }
}
