import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { installPlugin, validatePluginManifest } from '../src/lib/plugins.js';
import { runHooks } from '../src/lib/hook-runner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const SLACK_PLUGIN_ROOT = join(ROOT, 'plugins', 'plugin-slack-notify');
const JSON_REPORT_PLUGIN_ROOT = join(ROOT, 'plugins', 'plugin-json-report');
const GITHUB_ISSUES_PLUGIN_ROOT = join(ROOT, 'plugins', 'plugin-github-issues');

function writeJson(filePath, value) {
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function createGovernedProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-builtin-plugin-project-'));
  mkdirSync(join(root, '.agentxchain', 'prompts'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });

  writeJson(join(root, 'agentxchain.json'), {
    schema_version: '1.0',
    project: { id: 'builtin-plugin-test', name: 'Built-In Plugin Test', default_branch: 'main' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement safely.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
      },
    },
    runtimes: {
      'local-dev': {
        type: 'local_cli',
        command: ['echo', '{prompt}'],
        prompt_transport: 'argv',
      },
    },
    routing: {
      planning: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'human'],
      },
    },
    gates: {},
    hooks: {},
  });

  writeJson(join(root, '.agentxchain', 'state.json'), {
    schema_version: '1.1',
    project_id: 'builtin-plugin-test',
    run_id: null,
    status: 'idle',
    phase: 'planning',
    active_turns: {},
    turn_sequence: 0,
    accepted_count: 0,
    rejected_count: 0,
    blocked_on: null,
    blocked_reason: null,
    next_recommended_role: null,
    protocol_mode: 'governed',
  });

  return root;
}

async function withEnv(key, value, fn) {
  const previous = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }

  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
}

async function waitForFile(filePath, timeoutMs = 5000) {
  const start = Date.now();
  while (!existsSync(filePath)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${filePath}`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
}

describe('built-in plugin packages', () => {
  it('AT-BUILTIN-PLUGIN-001: built-in plugin manifests exist and validate', () => {
    const pluginRoots = [SLACK_PLUGIN_ROOT, JSON_REPORT_PLUGIN_ROOT, GITHUB_ISSUES_PLUGIN_ROOT];

    for (const pluginRoot of pluginRoots) {
      assert.ok(existsSync(pluginRoot), `missing plugin root: ${pluginRoot}`);
      const manifest = readJson(join(pluginRoot, 'agentxchain-plugin.json'));
      const pkg = readJson(join(pluginRoot, 'package.json'));
      const validation = validatePluginManifest(manifest, pluginRoot);

      assert.equal(validation.ok, true, validation.errors?.join('\n'));
      assert.equal(manifest.name, pkg.name);
      assert.equal(manifest.version, pkg.version);
    }
  });

  it('AT-BUILTIN-PLUGIN-002: built-in plugins install from repo-local paths', () => {
    const project = createGovernedProject();

    try {
      const slackInstall = installPlugin(SLACK_PLUGIN_ROOT, project);
      assert.equal(slackInstall.ok, true, slackInstall.error);

      const jsonInstall = installPlugin(JSON_REPORT_PLUGIN_ROOT, project);
      assert.equal(jsonInstall.ok, true, jsonInstall.error);

      const githubInstall = installPlugin(GITHUB_ISSUES_PLUGIN_ROOT, project, {
        config: {
          repo: 'acme/example',
          issue_number: 42,
        },
      });
      assert.equal(githubInstall.ok, true, githubInstall.error);

      const config = readJson(join(project, 'agentxchain.json'));
      assert.ok(config.plugins['@agentxchain/plugin-slack-notify']);
      assert.ok(config.plugins['@agentxchain/plugin-json-report']);
      assert.ok(config.plugins['@agentxchain/plugin-github-issues']);
      assert.deepEqual(
        config.plugins['@agentxchain/plugin-slack-notify'].hooks.before_gate,
        ['slack_notify_gate'],
      );
      assert.deepEqual(
        config.plugins['@agentxchain/plugin-json-report'].hooks.after_acceptance,
        ['json_report_acceptance'],
      );
      assert.deepEqual(
        config.plugins['@agentxchain/plugin-github-issues'].hooks.after_acceptance,
        ['github_issues_acceptance'],
      );
      assert.match(
        config.hooks.after_acceptance[0].command[1],
        /^\.agentxchain\/plugins\//,
        'installed hook commands should be rewritten into .agentxchain/plugins/',
      );
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('AT-BUILTIN-PLUGIN-003: slack plugin posts notifications and degrades to warn when webhook config is missing', async () => {
    const project = createGovernedProject();
    const portFile = join(project, 'slack-port.txt');
    const requestsFile = join(project, 'slack-requests.jsonl');
const serverScript = `
const { appendFileSync, writeFileSync } = require('node:fs');
const { createServer } = require('node:http');
const [portFile, requestsFile] = process.argv.slice(1);
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    appendFileSync(requestsFile, body + '\\n');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
});
server.listen(0, '127.0.0.1', () => {
  writeFileSync(portFile, String(server.address().port));
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`;
    const server = spawn(process.execPath, ['-e', serverScript, portFile, requestsFile], {
      stdio: ['ignore', 'ignore', 'inherit'],
    });

    await waitForFile(portFile);
    const webhookUrl = `http://127.0.0.1:${readFileSync(portFile, 'utf8').trim()}/slack`;

    try {
      const install = installPlugin(SLACK_PLUGIN_ROOT, project);
      assert.equal(install.ok, true, install.error);
      const config = readJson(join(project, 'agentxchain.json'));

      await withEnv('AGENTXCHAIN_SLACK_WEBHOOK_URL', webhookUrl, async () => {
        const acceptance = runHooks(project, config.hooks, 'after_acceptance', {
          turn_id: 'turn_accept_1',
          role_id: 'dev',
          decisions_count: 2,
          objections_count: 1,
          run_status: 'active',
          phase: 'planning',
        }, {
          run_id: 'run_builtin_plugin',
          turn_id: 'turn_accept_1',
        });
        assert.equal(acceptance.ok, true);
        assert.equal(acceptance.results[0].verdict, 'allow');

        const gate = runHooks(project, config.hooks, 'before_gate', {
          gate_type: 'phase_transition',
          current_phase: 'planning',
          target_phase: 'implementation',
          history_length: 4,
        }, {
          run_id: 'run_builtin_plugin',
        });
        assert.equal(gate.ok, true);
        assert.equal(gate.results[0].verdict, 'allow');

        const escalation = runHooks(project, config.hooks, 'on_escalation', {
          blocked_reason: 'validation_failed',
          recovery_action: 'Fix the staged result and rerun step --resume',
          failed_turn_id: 'turn_accept_1',
          failed_role: 'dev',
          last_error: 'schema mismatch',
        }, {
          run_id: 'run_builtin_plugin',
          turn_id: 'turn_accept_1',
        });
        assert.equal(escalation.ok, true);
        assert.equal(escalation.results[0].verdict, 'allow');
      });

      const missingWebhook = await withEnv('AGENTXCHAIN_SLACK_WEBHOOK_URL', undefined, () => (
        runHooks(project, config.hooks, 'after_acceptance', {
          turn_id: 'turn_accept_2',
          role_id: 'qa',
          decisions_count: 0,
          objections_count: 2,
          run_status: 'paused',
          phase: 'qa',
        }, {
          run_id: 'run_builtin_plugin',
          turn_id: 'turn_accept_2',
        })
      ));
      assert.equal(missingWebhook.ok, true);
      assert.equal(missingWebhook.results[0].verdict, 'warn');
      assert.match(missingWebhook.results[0].message, /missing.*webhook/i);

      const requests = readFileSync(requestsFile, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      assert.equal(requests.length, 3, 'expected Slack webhook delivery for all three built-in hook phases');
      assert.match(requests[0].text, /accepted turn/i);
      assert.match(requests[1].text, /awaiting approval/i);
      assert.match(requests[2].text, /escalation/i);
    } finally {
      server.kill('SIGTERM');
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('AT-BUILTIN-PLUGIN-004: json report plugin writes timestamped and latest report artifacts', () => {
    const project = createGovernedProject();

    try {
      const install = installPlugin(JSON_REPORT_PLUGIN_ROOT, project);
      assert.equal(install.ok, true, install.error);
      const config = readJson(join(project, 'agentxchain.json'));

      const acceptance = runHooks(project, config.hooks, 'after_acceptance', {
        turn_id: 'turn_report_1',
        role_id: 'dev',
        decisions_count: 1,
        objections_count: 1,
        run_status: 'active',
        phase: 'planning',
      }, {
        run_id: 'run_report_plugin',
        turn_id: 'turn_report_1',
      });
      assert.equal(acceptance.ok, true);
      assert.equal(acceptance.results[0].verdict, 'allow');

      const gate = runHooks(project, config.hooks, 'before_gate', {
        gate_type: 'run_completion',
        current_phase: 'qa',
        target_phase: null,
        history_length: 7,
      }, {
        run_id: 'run_report_plugin',
      });
      assert.equal(gate.ok, true);
      assert.equal(gate.results[0].verdict, 'allow');

      const reportsDir = join(project, '.agentxchain', 'reports');
      assert.ok(existsSync(reportsDir), 'expected .agentxchain/reports to exist');
      assert.ok(existsSync(join(reportsDir, 'latest.json')));
      assert.ok(existsSync(join(reportsDir, 'latest-after_acceptance.json')));
      assert.ok(existsSync(join(reportsDir, 'latest-before_gate.json')));

      const latest = readJson(join(reportsDir, 'latest.json'));
      const latestAcceptance = readJson(join(reportsDir, 'latest-after_acceptance.json'));
      const latestGate = readJson(join(reportsDir, 'latest-before_gate.json'));

      assert.equal(latest.plugin_name, '@agentxchain/plugin-json-report');
      assert.equal(latest.hook_phase, 'before_gate');
      assert.equal(latestAcceptance.payload.turn_id, 'turn_report_1');
      assert.equal(latestAcceptance.payload.phase, 'planning');
      assert.equal(latestGate.payload.gate_type, 'run_completion');

      const stampedReports = readdirSync(reportsDir).filter((file) => file.endsWith('.json') && file.includes('T'));
      assert.ok(stampedReports.length >= 2, 'expected timestamped report artifacts for each invocation');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('AT-BUILTIN-PLUGIN-005: GitHub issues plugin upserts one run comment, preserves unrelated labels, and warns when token is missing', async () => {
    const project = createGovernedProject();
    const portFile = join(project, 'github-port.txt');
    const requestsFile = join(project, 'github-requests.jsonl');
const serverScript = `
const { appendFileSync, writeFileSync } = require('node:fs');
const { createServer } = require('node:http');

const [portFile, requestsFile] = process.argv.slice(1);
let nextCommentId = 1000;
const state = {
  labels: ['bug', 'triaged'],
  comments: [],
};

function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

function record(req, body) {
  appendFileSync(requestsFile, JSON.stringify({
    method: req.method,
    url: req.url,
    authorization: req.headers.authorization || null,
    body: body || null,
  }) + '\\n');
}

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    record(req, body);

    if (req.method === 'GET' && req.url === '/repos/acme/example/issues/42') {
      return sendJson(res, 200, {
        number: 42,
        labels: state.labels.map((name) => ({ name })),
      });
    }

    if (req.method === 'PUT' && req.url === '/repos/acme/example/issues/42/labels') {
      const parsed = body ? JSON.parse(body) : {};
      state.labels = Array.isArray(parsed.labels) ? parsed.labels.slice() : [];
      return sendJson(res, 200, state.labels.map((name) => ({ name })));
    }

    if (req.method === 'GET' && req.url.startsWith('/repos/acme/example/issues/42/comments')) {
      return sendJson(res, 200, state.comments);
    }

    if (req.method === 'POST' && req.url === '/repos/acme/example/issues/42/comments') {
      const parsed = body ? JSON.parse(body) : {};
      const comment = { id: nextCommentId++, body: parsed.body || '' };
      state.comments.push(comment);
      return sendJson(res, 201, comment);
    }

    if (req.method === 'PATCH' && req.url.startsWith('/repos/acme/example/issues/comments/')) {
      const id = Number(req.url.split('/').pop());
      const parsed = body ? JSON.parse(body) : {};
      const comment = state.comments.find((entry) => entry.id === id);
      if (!comment) {
        return sendJson(res, 404, { message: 'not found' });
      }
      comment.body = parsed.body || '';
      return sendJson(res, 200, comment);
    }

    return sendJson(res, 404, { message: 'not found' });
  });
});

server.listen(0, '127.0.0.1', () => {
  writeFileSync(portFile, String(server.address().port));
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`;
    const server = spawn(process.execPath, ['-e', serverScript, portFile, requestsFile], {
      stdio: ['ignore', 'ignore', 'inherit'],
    });

    await waitForFile(portFile);
    const apiBaseUrl = `http://127.0.0.1:${readFileSync(portFile, 'utf8').trim()}`;

    try {
      const install = installPlugin(GITHUB_ISSUES_PLUGIN_ROOT, project, {
        config: {
          repo: 'acme/example',
          issue_number: 42,
          token_env: 'AGENTXCHAIN_GITHUB_TEST_TOKEN',
          api_base_url: apiBaseUrl,
        },
      });
      assert.equal(install.ok, true, install.error);
      const config = readJson(join(project, 'agentxchain.json'));

      await withEnv('AGENTXCHAIN_GITHUB_TEST_TOKEN', 'test-token', async () => {
        const acceptance1 = runHooks(project, config.hooks, 'after_acceptance', {
          turn_id: 'turn_accept_1',
          role_id: 'dev',
          decisions_count: 2,
          objections_count: 1,
          run_status: 'active',
          phase: 'implementation',
          history_entry_index: 4,
        }, {
          run_id: 'run_github_plugin',
          turn_id: 'turn_accept_1',
        });
        assert.equal(acceptance1.ok, true);
        assert.equal(acceptance1.results[0].verdict, 'allow');

        const acceptance2 = runHooks(project, config.hooks, 'after_acceptance', {
          turn_id: 'turn_accept_2',
          role_id: 'qa',
          decisions_count: 0,
          objections_count: 2,
          run_status: 'active',
          phase: 'qa',
          history_entry_index: 5,
        }, {
          run_id: 'run_github_plugin',
          turn_id: 'turn_accept_2',
        });
        assert.equal(acceptance2.ok, true);
        assert.equal(acceptance2.results[0].verdict, 'allow');

        const escalation = runHooks(project, config.hooks, 'on_escalation', {
          blocked_reason: 'validation_failed',
          recovery_action: 'Fix the issue and rerun agentxchain step --resume',
          failed_turn_id: 'turn_accept_2',
          failed_role: 'qa',
          last_error: 'schema mismatch',
        }, {
          run_id: 'run_github_plugin',
          turn_id: 'turn_accept_2',
        });
        assert.equal(escalation.ok, true);
        assert.equal(escalation.results[0].verdict, 'allow');
      });

      const missingToken = await withEnv('AGENTXCHAIN_GITHUB_TEST_TOKEN', undefined, () => (
        runHooks(project, config.hooks, 'after_acceptance', {
          turn_id: 'turn_accept_3',
          role_id: 'dev',
          decisions_count: 1,
          objections_count: 0,
          run_status: 'active',
          phase: 'implementation',
          history_entry_index: 6,
        }, {
          run_id: 'run_github_plugin',
          turn_id: 'turn_accept_3',
        })
      ));
      assert.equal(missingToken.ok, true);
      assert.equal(missingToken.results[0].verdict, 'warn');
      assert.match(missingToken.results[0].message, /missing.*token/i);

      const requests = readFileSync(requestsFile, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));

      const postComments = requests.filter((entry) => entry.method === 'POST' && entry.url === '/repos/acme/example/issues/42/comments');
      const patchComments = requests.filter((entry) => entry.method === 'PATCH' && entry.url.startsWith('/repos/acme/example/issues/comments/'));
      const putLabels = requests.filter((entry) => entry.method === 'PUT' && entry.url === '/repos/acme/example/issues/42/labels');

      assert.equal(postComments.length, 1, 'plugin must create exactly one comment for the run');
      assert.equal(patchComments.length, 2, 'subsequent run updates must patch the same comment');
      assert.equal(putLabels.length, 3, 'managed labels must sync on each successful update');
      assert.ok(requests.every((entry) => !entry.authorization || entry.authorization === 'Bearer test-token'));

      const finalLabelBody = JSON.parse(putLabels[2].body);
      assert.deepEqual(finalLabelBody.labels, ['bug', 'triaged', 'agentxchain', 'agentxchain:blocked']);

      const finalCommentPatch = JSON.parse(patchComments[1].body);
      assert.match(finalCommentPatch.body, /blocked/i);
      assert.match(finalCommentPatch.body, /run_github_plugin/);
      assert.doesNotMatch(finalCommentPatch.body, /close issue/i);
      assert.doesNotMatch(finalCommentPatch.body, /approved/i);
    } finally {
      server.kill('SIGTERM');
      rmSync(project, { recursive: true, force: true });
    }
  });
});
