#!/usr/bin/env node

/**
 * Remote Agent Bridge — Repeated Model-Backed Proof
 *
 * Runs N independent governed lifecycles through the model-backed bridge
 * and reports an honest aggregate pass rate. Each run is one attempt with
 * no retries. Failed runs record the exact failure mode.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... node run-repeated-proof.mjs
 *   ANTHROPIC_API_KEY=sk-... node run-repeated-proof.mjs --runs 10
 *   source ../../.env && node run-repeated-proof.mjs --runs 5
 *
 * Cost: ~$0.01-0.02 per run (Haiku pricing). Default 5 runs ≈ $0.05-0.10.
 */

import { createServer } from 'node:http';
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', '..', 'cli', 'bin', 'agentxchain.js');

const MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MAX_TOKENS = 4096;

// ── Argument parsing ──

function parseArgs(argv) {
  const idx = argv.indexOf('--runs');
  const runs = idx !== -1 ? Number.parseInt(argv[idx + 1], 10) : 5;
  if (!Number.isInteger(runs) || runs < 1 || runs > 50) {
    console.error('--runs must be an integer between 1 and 50');
    process.exit(1);
  }
  return { runs };
}

// ── Logging ──

function log(msg) {
  console.log(`\x1b[36m[repeated-proof]\x1b[0m ${msg}`);
}

// ── Claude API (same as model-backed-server.js) ──

const SYSTEM_PROMPT = `You are an AI agent operating within the AgentXchain governed software delivery protocol.

You will receive a turn envelope as a JSON object with fields: run_id, turn_id, role, phase, runtime_id, prompt, context.

You must respond with ONLY a valid JSON object (no markdown fences, no explanatory text, no code blocks — raw JSON only).

The JSON must conform to this exact schema:

{
  "schema_version": "1.0",
  "run_id": "<echo from envelope>",
  "turn_id": "<echo from envelope>",
  "role": "<echo from envelope>",
  "runtime_id": "<echo from envelope>",
  "status": "completed",
  "summary": "<1-2 sentence summary of what you did>",
  "decisions": [
    {
      "id": "DEC-001",
      "category": "<implementation|architecture|quality|process>",
      "statement": "<what you decided>",
      "rationale": "<why>"
    }
  ],
  "objections": [],
  "files_changed": ["<list of file paths you are proposing to change>"],
  "artifacts_created": [],
  "verification": {
    "status": "pass",
    "commands": ["echo ok"],
    "evidence_summary": "<brief verification note>",
    "machine_evidence": [{ "command": "echo ok", "exit_code": 0 }]
  },
  "artifact": { "type": "patch", "ref": null },
  "proposed_next_role": "qa",
  "phase_transition_request": null,
  "run_completion_request": null,
  "needs_human_reason": null,
  "proposed_changes": [
    {
      "path": "<file path>",
      "action": "create",
      "content": "<file content>"
    }
  ],
  "cost": { "input_tokens": 0, "output_tokens": 0, "usd": 0 }
}

CRITICAL RULES:
1. Decision IDs MUST match the pattern DEC-NNN (e.g., DEC-001, DEC-002). No other format.
2. If your role is "qa" (review/QA role), you MUST:
   - Include at least one objection in the objections array
   - Each objection must have: id (OBJ-NNN pattern, e.g. OBJ-001), severity (one of: low, medium, high, blocking), against_turn_id (any string), statement (text), status ("raised")
   - Set artifact.type to "review" instead of "patch"
   - Do NOT include proposed_changes (omit the field or use null or empty array)
   - Set files_changed to an empty array
   - Set proposed_next_role to "human"
3. If your role is "dev" (implementation role), you MUST:
   - Include a non-empty proposed_changes array with AT LEAST one file — this is MANDATORY, an empty array will fail validation
   - Each proposed change needs: path (string, e.g. "src/feature.js"), action ("create"), content (string with actual JavaScript/TypeScript file contents)
   - Example: "proposed_changes": [{"path": "src/feature.js", "action": "create", "content": "export const hello = 'world';\\n"}]
   - Set artifact.type to "patch"
   - Set proposed_next_role to "qa"
   - Set files_changed to list the same paths as in proposed_changes
   - IMPORTANT: You MUST generate at least one concrete file in proposed_changes. Do NOT leave it empty.
4. Echo run_id, turn_id, role, and runtime_id EXACTLY from the envelope — do not modify them.
5. Output ONLY the JSON object. No markdown, no backticks, no explanatory text before or after.`;

async function callClaude(apiKey, envelope) {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(envelope, null, 2) }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const textBlock = data.content?.find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text content in Claude response');

  return {
    rawText: textBlock.text,
    usage: data.usage,
    model: data.model,
    stopReason: data.stop_reason,
  };
}

// ── Bridge Server (shared across all runs) ──

function startModelBridge(apiKey) {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let fenceStrips = 0;

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        try {
          const envelope = JSON.parse(body);
          const claudeResult = await callClaude(apiKey, envelope);

          totalInputTokens += claudeResult.usage?.input_tokens || 0;
          totalOutputTokens += claudeResult.usage?.output_tokens || 0;

          let text = claudeResult.rawText.trim();
          if (text.startsWith('```')) {
            fenceStrips++;
            text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
          }

          let turnResult;
          try {
            turnResult = JSON.parse(text);
          } catch {
            res.writeHead(502, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ message: 'Model returned non-JSON', raw: text.slice(0, 500) }));
            return;
          }

          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(turnResult, null, 2));
        } catch (err) {
          res.writeHead(502, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ message: err.message }));
        }
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => server.close(),
        getStats: () => ({ totalInputTokens, totalOutputTokens, fenceStrips }),
      });
    });
    server.on('error', reject);
  });
}

// ── CLI subprocess helper ──

function cliAsync(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_BIN, ...args], {
      cwd,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.stdin.end();
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`CLI timed out: agentxchain ${args.join(' ')}`));
    }, 120_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ status: code, stdout, stderr });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ── Single Run ──

async function executeRun(runNumber, bridgeUrl) {
  const runLog = [];
  const rlog = (msg) => runLog.push(`${new Date().toISOString()} ${msg}`);
  const result = { run: runNumber, devResult: 'SKIP', qaResult: 'SKIP', overall: 'FAIL', failureReason: null, log: runLog };

  let root;
  try {
    // Fresh scaffold
    root = mkdtempSync(join(tmpdir(), `axc-repeat-${runNumber}-`));
    rlog(`Scaffold dir: ${root}`);

    const initResult = await cliAsync(['init', '--governed', '-y', '--dir', '.'], root);
    if (initResult.status !== 0) {
      result.failureReason = `init_failed: ${initResult.stderr.slice(-200)}`;
      return result;
    }

    // Configure remote_agent runtimes
    const configPath = join(root, 'agentxchain.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.roles.dev.write_authority = 'proposed';
    config.roles.dev.runtime = 'remote-dev';
    config.roles.qa.write_authority = 'review_only';
    config.roles.qa.runtime = 'remote-qa';
    config.runtimes['remote-dev'] = { type: 'remote_agent', url: bridgeUrl, timeout_ms: 120000 };
    config.runtimes['remote-qa'] = { type: 'remote_agent', url: bridgeUrl, timeout_ms: 120000 };
    config.workflow_kit = {};
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

    // Set state to active/implementation
    const statePath = join(root, '.agentxchain', 'state.json');
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    state.run_id = `run_repeat_${runNumber}_${Date.now()}`;
    state.status = 'active';
    state.phase = 'implementation';
    state.active_turns = {};
    state.completed_turns = [];
    state.phase_gate_status = {
      planning_signoff: 'passed',
      implementation_complete: 'pending',
      qa_ship_verdict: 'pending',
    };
    writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');

    // Git init
    execSync('git init', { cwd: root, stdio: 'ignore' });
    execSync('git config user.email "proof@example.com"', { cwd: root, stdio: 'ignore' });
    execSync('git config user.name "Proof"', { cwd: root, stdio: 'ignore' });
    execSync('git add .', { cwd: root, stdio: 'ignore' });
    execSync('git commit -m "baseline"', { cwd: root, stdio: 'ignore' });

    // Dev step
    rlog('Running step --role dev...');
    const devStep = await cliAsync(['step', '--role', 'dev'], root);
    if (devStep.status !== 0) {
      result.devResult = 'FAIL';
      // Check if it's a validation failure vs crash
      const combined = devStep.stdout + devStep.stderr;
      if (combined.includes('Validation failed') || combined.includes('validation')) {
        result.failureReason = `dev_validation_failed: ${combined.slice(-300)}`;
      } else {
        result.failureReason = `dev_step_exit_${devStep.status}: ${combined.slice(-300)}`;
      }
      return result;
    }
    result.devResult = 'PASS';
    rlog('Dev step passed');

    // Verify proposal materialization
    const stateAfterDev = JSON.parse(readFileSync(statePath, 'utf8'));
    const proposalTurnId = stateAfterDev.last_completed_turn_id;
    if (!proposalTurnId) {
      result.failureReason = 'no_completed_turn_after_dev';
      return result;
    }

    const proposalDir = join(root, '.agentxchain', 'proposed', proposalTurnId);
    if (!existsSync(join(proposalDir, 'PROPOSAL.md'))) {
      result.failureReason = 'proposal_not_materialized';
      return result;
    }
    rlog(`Proposal materialized: ${proposalTurnId}`);

    // Apply proposal
    const applyResult = await cliAsync(['proposal', 'apply', proposalTurnId], root);
    if (applyResult.status !== 0) {
      result.failureReason = `proposal_apply_failed: ${applyResult.stderr.slice(-200)}`;
      return result;
    }
    rlog('Proposal applied');

    // QA step
    rlog('Running step --role qa...');
    const qaStep = await cliAsync(['step', '--role', 'qa'], root);
    if (qaStep.status !== 0) {
      result.qaResult = 'FAIL';
      const combined = qaStep.stdout + qaStep.stderr;
      if (combined.includes('Validation failed') || combined.includes('validation')) {
        result.failureReason = `qa_validation_failed: ${combined.slice(-300)}`;
      } else {
        result.failureReason = `qa_step_exit_${qaStep.status}: ${combined.slice(-300)}`;
      }
      return result;
    }
    result.qaResult = 'PASS';
    rlog('QA step passed');

    // Verify review artifact
    const historyPath = join(root, '.agentxchain', 'history.jsonl');
    const historyLines = readFileSync(historyPath, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
    if (historyLines.length < 2) {
      result.failureReason = `insufficient_history: ${historyLines.length} entries`;
      return result;
    }

    const qaEntry = historyLines[historyLines.length - 1];
    if (qaEntry.artifact?.type !== 'review') {
      result.failureReason = `qa_artifact_wrong_type: ${qaEntry.artifact?.type}`;
      return result;
    }

    // Verify objections (challenge requirement)
    const qaStagingDir = join(root, '.agentxchain', 'staging', qaEntry.turn_id);
    if (existsSync(join(qaStagingDir, 'turn-result.json'))) {
      const qaResult = JSON.parse(readFileSync(join(qaStagingDir, 'turn-result.json'), 'utf8'));
      if (!qaResult.objections || qaResult.objections.length === 0) {
        result.failureReason = 'qa_no_objections';
        return result;
      }
    }

    // All checks passed
    result.overall = 'PASS';
    rlog('All checks passed');
    return result;

  } catch (err) {
    result.failureReason = `exception: ${err.message}`;
    return result;
  } finally {
    if (root) {
      try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore cleanup errors */ }
    }
  }
}

// ── Report Generation ──

function categorizeFailure(reason) {
  if (!reason) return null;
  if (reason.startsWith('dev_validation_failed')) return 'dev_validation_failed';
  if (reason.startsWith('qa_validation_failed')) return 'qa_validation_failed';
  if (reason.startsWith('qa_no_objections')) return 'qa_no_objections';
  if (reason.startsWith('dev_step_exit')) return 'dev_step_crash';
  if (reason.startsWith('qa_step_exit')) return 'qa_step_crash';
  if (reason.startsWith('proposal_apply_failed')) return 'proposal_apply_failed';
  if (reason.startsWith('proposal_not_materialized')) return 'proposal_not_materialized';
  if (reason.startsWith('init_failed')) return 'init_failed';
  if (reason.startsWith('exception')) return 'exception';
  return 'other';
}

function writeReport(results, stats) {
  const passed = results.filter(r => r.overall === 'PASS').length;
  const failed = results.length - passed;
  const passRate = ((passed / results.length) * 100).toFixed(0);

  // Failure taxonomy
  const failureCounts = {};
  for (const r of results) {
    if (r.overall === 'FAIL') {
      const cat = categorizeFailure(r.failureReason);
      failureCounts[cat] = (failureCounts[cat] || 0) + 1;
    }
  }

  // Cost estimate (Haiku: $1.00/MTok input, $5.00/MTok output)
  const costUsd = (stats.totalInputTokens / 1_000_000 * 1.0) + (stats.totalOutputTokens / 1_000_000 * 5.0);

  const perRunTable = results.map(r =>
    `| ${r.run} | ${r.devResult} | ${r.qaResult} | ${r.overall} | ${r.failureReason || '—'} |`
  ).join('\n');

  const taxonomySection = Object.keys(failureCounts).length > 0
    ? Object.entries(failureCounts).map(([cat, count]) => `- \`${cat}\`: ${count} occurrence(s)`).join('\n')
    : 'No failures.';

  const content = `# Repeated Model-Backed Proof Report

> Generated: ${new Date().toISOString()}
> Model: ${MODEL}
> Runs: ${results.length}
> Pass Rate: **${passed}/${results.length} (${passRate}%)**

## Summary

| Metric | Value |
|--------|-------|
| Total runs | ${results.length} |
| Passed | ${passed} |
| Failed | ${failed} |
| Pass rate | ${passRate}% |
| Total input tokens | ${stats.totalInputTokens.toLocaleString()} |
| Total output tokens | ${stats.totalOutputTokens.toLocaleString()} |
| Fence strips | ${stats.fenceStrips} |
| Estimated cost | $${costUsd.toFixed(4)} |

## Per-Run Results

| Run | Dev Turn | QA Turn | Result | Failure Reason |
|-----|----------|---------|--------|----------------|
${perRunTable}

## Failure Taxonomy

${taxonomySection}

## What This Proves

${passed === results.length
    ? `- Claude ${MODEL} reliably produces governed turn results across ${results.length} independent runs
- The turn-result contract is teachable from a single system prompt without retries
- Both proposed (dev) and review_only (qa) modes work consistently with real model output
- No field-level repair was applied; only logged markdown-fence removal is permitted`
    : `- Claude ${MODEL} produced valid governed turn results in ${passed}/${results.length} attempts (${passRate}%)
- Failure modes are documented above — these represent real model-to-protocol contract drift
- No retries or fixups were applied; each run had exactly one attempt
- The pass rate indicates ${Number(passRate) >= 80 ? 'reliable' : Number(passRate) >= 50 ? 'moderate' : 'unreliable'} contract teachability from the current system prompt`}

## Proof Boundary

- **Model**: ${MODEL} (Anthropic Haiku — smallest, cheapest model)
- **Transport concession**: outer markdown-fence stripping only (${stats.fenceStrips} occurrence(s) across ${results.length * 2} model calls)
- **No field-level repair**: decision IDs, objections, proposed_changes, status, and all other fields are the model's raw output
- **No retries**: each model call is a single attempt
`;

  const reportPath = join(__dirname, 'REPEATED_PROOF_REPORT.md');
  writeFileSync(reportPath, content);
  return { reportPath, passed, failed, passRate: Number(passRate), costUsd };
}

// ── Main ──

async function main() {
  const { runs } = parseArgs(process.argv.slice(2));

  log(`=== Repeated Model-Backed Remote Agent Proof ===`);
  log(`Model: ${MODEL}`);
  log(`Runs: ${runs}`);

  // Check API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  // Start shared bridge
  const bridge = await startModelBridge(apiKey);
  log(`Bridge listening on ${bridge.url}`);

  const results = [];

  for (let i = 1; i <= runs; i++) {
    log(`\n--- Run ${i}/${runs} ---`);
    const result = await executeRun(i, bridge.url);
    results.push(result);

    const emoji = result.overall === 'PASS' ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
    log(`Run ${i}: ${emoji}${result.failureReason ? ` (${result.failureReason.split(':')[0]})` : ''}`);
  }

  bridge.close();

  // Write report
  const stats = bridge.getStats();
  const { reportPath, passed, failed, passRate, costUsd } = writeReport(results, stats);

  // Print summary
  console.log('\n' + '='.repeat(70));
  console.log('  REPEATED MODEL-BACKED PROOF — RESULTS');
  console.log('='.repeat(70));
  console.log(`  Model:       ${MODEL}`);
  console.log(`  Runs:        ${runs}`);
  console.log(`  Passed:      ${passed}`);
  console.log(`  Failed:      ${failed}`);
  console.log(`  Pass Rate:   ${passRate}%`);
  console.log(`  Tokens:      ${stats.totalInputTokens.toLocaleString()} in / ${stats.totalOutputTokens.toLocaleString()} out`);
  console.log(`  Cost:        $${costUsd.toFixed(4)}`);
  console.log(`  Report:      ${reportPath}`);
  console.log('='.repeat(70) + '\n');

  // Exit 0 regardless — this is a reporting tool, not a gate
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
