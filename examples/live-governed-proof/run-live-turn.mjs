#!/usr/bin/env node

/**
 * Live Governed Proof — executes one governed turn against a real LLM API.
 *
 * This proves that AgentXchain governs real model output, not mock data.
 * It uses the runner interface + api_proxy adapter to:
 *   1. Scaffold a governed project
 *   2. Init run, assign a review-only turn, write dispatch bundle
 *   3. Dispatch to a real LLM via api_proxy
 *   4. Accept the result and validate all governed artifacts
 *
 * Usage:
 *   node examples/live-governed-proof/run-live-turn.mjs [--json] [--provider anthropic|openai]
 *
 * Environment:
 *   ANTHROPIC_API_KEY — required for provider=anthropic (default)
 *   OPENAI_API_KEY    — required for provider=openai
 *
 * Exit codes:
 *   0 — proof passed, or skipped (no credentials)
 *   1 — proof failed
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes, createHash } from 'crypto';
import { fileURLToPath } from 'url';

// ── Import ONLY from declared interfaces ─────────────────────────────────────
// Runner interface: lifecycle operations
// API proxy adapter: dispatch to real LLM
const cliRoot = join(fileURLToPath(import.meta.url), '..', '..', '..', 'cli');

const {
  initRun,
  assignTurn,
  acceptTurn,
  rejectTurn,
  writeDispatchBundle,
  getTurnStagingResultPath,
  RUNNER_INTERFACE_VERSION,
} = await import(join(cliRoot, 'src', 'lib', 'runner-interface.js'));

const { dispatchApiProxy } = await import(
  join(cliRoot, 'src', 'lib', 'adapters', 'api-proxy-adapter.js')
);

// ── CLI args ─────────────────────────────────────────────────────────────────

const jsonMode = process.argv.includes('--json');
const providerArg = process.argv.find((a, i) => process.argv[i - 1] === '--provider');
const provider = providerArg || 'anthropic';

const AUTH_ENV_MAP = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
};

const MODEL_MAP = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4o-mini',
};

// ── Gate check ───────────────────────────────────────────────────────────────

const authEnv = AUTH_ENV_MAP[provider];
if (!authEnv) {
  outputResult({ result: 'fail', error: `Unsupported provider: ${provider}` });
  process.exit(1);
}

if (!process.env[authEnv]) {
  outputResult({
    result: 'skip',
    reason: `${authEnv} not set — live proof requires API credentials`,
    provider,
  });
  process.exit(0);
}

// ── Config ───────────────────────────────────────────────────────────────────

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'live-governed-proof', name: 'Live Governed Proof', default_branch: 'main' },
    roles: {
      qa: {
        title: 'QA Reviewer',
        mandate: 'Review the project state and provide a governed assessment.',
        write_authority: 'review_only',
        runtime_class: 'api_proxy',
        runtime_id: 'api-qa',
      },
    },
    runtimes: {
      'api-qa': {
        type: 'api_proxy',
        provider,
        model: MODEL_MAP[provider],
        auth_env: authEnv,
        max_output_tokens: 2048,
        timeout_seconds: 60,
      },
    },
    routing: {
      planning: {
        entry_role: 'qa',
        allowed_next_roles: ['qa', 'human'],
        exit_gate: 'planning_signoff',
      },
    },
    gates: {},
    budget: { per_turn_max_usd: 0.50, per_run_max_usd: 2.0 },
    rules: { challenge_required: true, max_turn_retries: 3, max_deadlock_cycles: 1 },
    files: {
      talk: 'TALK.md',
      history: '.agentxchain/history.jsonl',
      state: '.agentxchain/state.json',
    },
    compat: {
      next_owner_source: 'state-json',
      lock_based_coordination: false,
      original_version: 4,
    },
  };
}

const QA_PROMPT = `# QA Reviewer — Role Prompt

You are a QA reviewer in a governed AgentXchain protocol run.

## Your Task

Review the current project state. This is a proof-of-concept governed turn. Provide a structured assessment.

## Requirements

1. You MUST raise at least one objection (protocol requirement for review_only roles).
2. You MUST include at least one decision.
3. Your artifact type must be "review".
4. You have review_only authority — you CANNOT modify files. Therefore files_changed and artifacts_created MUST be empty arrays [].
5. proposed_next_role MUST be either "qa" or "human". No other values are valid.

## Response Format

Respond with ONLY a valid JSON object. No markdown fences. No text before or after.

Copy this template EXACTLY, filling in only the quoted placeholder values:

{"schema_version":"1.0","run_id":"FILL_FROM_ASSIGNMENT","turn_id":"FILL_FROM_ASSIGNMENT","role":"qa","runtime_id":"api-qa","status":"completed","summary":"FILL_YOUR_ASSESSMENT","decisions":[{"id":"DEC-001","category":"review","statement":"FILL","rationale":"FILL"}],"objections":[{"id":"OBJ-001","severity":"low","statement":"FILL","status":"raised"}],"files_changed":[],"artifacts_created":[],"verification":{"status":"pass","commands":[],"evidence_summary":"Proof-of-concept review turn.","machine_evidence":[]},"artifact":{"type":"review","ref":null},"proposed_next_role":"human","phase_transition_request":null,"needs_human_reason":null,"cost":{"input_tokens":0,"output_tokens":0,"usd":0}}
`;

function scaffoldProject(root) {
  const config = makeConfig();
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  mkdirSync(join(root, '.agentxchain/prompts'), { recursive: true });
  writeFileSync(
    join(root, '.agentxchain/state.json'),
    JSON.stringify(
      {
        schema_version: '1.1',
        status: 'idle',
        phase: 'planning',
        run_id: null,
        active_turns: {},
        next_role: null,
        pending_phase_transition: null,
        pending_run_completion: null,
        blocked_on: null,
        blocked_reason: null,
      },
      null,
      2,
    ),
  );
  writeFileSync(join(root, '.agentxchain/history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain/decision-ledger.jsonl'), '');
  writeFileSync(join(root, '.agentxchain/prompts/qa.md'), QA_PROMPT);
  writeFileSync(join(root, 'TALK.md'), '# Talk\n');
  return config;
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function readJsonl(path) {
  const content = readFileSync(path, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map((line) => JSON.parse(line));
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const root = join(tmpdir(), `axc-live-proof-${randomBytes(6).toString('hex')}`);
  mkdirSync(root, { recursive: true });

  const errors = [];
  let runId = null;
  let turnId = null;
  let usage = null;
  let artifacts = null;

  try {
    // 1. Scaffold
    const config = scaffoldProject(root);

    // 2. Init run
    const runResult = initRun(root, config);
    if (!runResult.ok) {
      errors.push(`initRun failed: ${runResult.error}`);
      return finish(root, errors, { runId, turnId, usage, artifacts });
    }
    runId = runResult.state.run_id;

    // 3. Assign turn
    const assignResult = assignTurn(root, config, 'qa');
    if (!assignResult.ok) {
      errors.push(`assignTurn failed: ${assignResult.error}`);
      return finish(root, errors, { runId, turnId, usage, artifacts });
    }
    const turn = assignResult.turn;
    if (!turn || !turn.turn_id) {
      errors.push('assignTurn did not return a turn');
      return finish(root, errors, { runId, turnId, usage, artifacts });
    }
    turnId = turn.turn_id;

    // 4-9. Dispatch → Accept with governed retry (max 3 attempts)
    //       LLMs are nondeterministic. The protocol correctly rejects invalid
    //       turn results (wrong proposed_next_role, malformed arrays, etc.).
    //       Retrying on validation failure IS the governed protocol working.
    const MAX_ATTEMPTS = 3;
    let accepted = false;
    let attemptsUsed = 0;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // Reload state (may have changed from previous reject)
      const currentState = JSON.parse(
        readFileSync(join(root, '.agentxchain/state.json'), 'utf8'),
      );

      // Write dispatch bundle
      const bundleResult = writeDispatchBundle(root, currentState, config);
      if (!bundleResult.ok) {
        errors.push(`writeDispatchBundle failed: ${bundleResult.error}`);
        return finish(root, errors, { runId, turnId, usage, artifacts });
      }

      // Dispatch to real LLM via api_proxy
      const dispatchResult = await dispatchApiProxy(root, currentState, config, {
        skipManifestVerification: true,
      });
      if (!dispatchResult.ok) {
        const errMsg = dispatchResult.classified
          ? `${dispatchResult.classified.error_class}: ${dispatchResult.classified.message}`
          : dispatchResult.error || 'Unknown dispatch error';
        errors.push(`dispatchApiProxy failed (attempt ${attempt}): ${errMsg}`);
        if (dispatchResult.classified) {
          errors.push(`Recovery: ${dispatchResult.classified.recovery}`);
        }
        return finish(root, errors, { runId, turnId, usage, artifacts });
      }
      usage = dispatchResult.usage || null;

      // Validate dispatch and staging artifacts BEFORE acceptance
      // (acceptTurn cleans up both dirs after commit)
      artifacts = validatePreAcceptanceArtifacts(root, turnId);
      if (artifacts.errors.length > 0) {
        errors.push(...artifacts.errors);
        return finish(root, errors, { runId, turnId, usage, artifacts });
      }

      // Try to accept
      const acceptResult = acceptTurn(root, config);
      attemptsUsed = attempt;
      if (acceptResult.ok) {
        accepted = true;
        break;
      }

      // Acceptance failed — if this is a validation error and we have retries left,
      // reject the turn and retry (this is governed protocol behavior)
      if (attempt < MAX_ATTEMPTS) {
        // rejectTurn increments the attempt counter and keeps the same turn
        // active with status 'retrying' — no re-assignment needed
        const rejectResult = rejectTurn(root, config, null, `Model output validation failed (attempt ${attempt}): ${acceptResult.error}`);
        if (!rejectResult.ok) {
          errors.push(`rejectTurn failed: ${rejectResult.error}`);
          return finish(root, errors, { runId, turnId, usage, artifacts, attemptsUsed });
        }
      } else {
        errors.push(`acceptTurn failed after ${MAX_ATTEMPTS} attempts: ${acceptResult.error}`);
        return finish(root, errors, { runId, turnId, usage, artifacts, attemptsUsed });
      }
    }

    if (!accepted) {
      errors.push('Turn was not accepted after all retry attempts');
      return finish(root, errors, { runId, turnId, usage, artifacts, attemptsUsed });
    }

    // Validate post-acceptance governed artifacts (state, history, ledger)
    const postAcceptance = validatePostAcceptanceArtifacts(root);
    artifacts.state = postAcceptance.state;
    artifacts.history = postAcceptance.history;
    artifacts.ledger = postAcceptance.ledger;
    if (postAcceptance.errors.length > 0) {
      errors.push(...postAcceptance.errors);
    }

    return finish(root, errors, { runId, turnId, usage, artifacts, attemptsUsed });
  } catch (err) {
    errors.push(`Unexpected error: ${err.stack || err.message}`);
    return finish(root, errors, { runId, turnId, usage, artifacts });
  }
}

/**
 * Validate dispatch and staging artifacts BEFORE acceptance.
 * acceptTurn cleans up both dirs after commit, so these must be checked first.
 */
function validatePreAcceptanceArtifacts(root, turnId) {
  const result = { state: null, history: null, ledger: null, dispatch: null, staging: null, errors: [] };

  // Dispatch audit artifacts
  const dispatchDir = join(root, '.agentxchain/dispatch/turns', turnId);
  const dispatchFiles = ['PROMPT.md', 'CONTEXT.md', 'ASSIGNMENT.json', 'API_REQUEST.json'];
  const dispatchPresent = {};
  for (const f of dispatchFiles) {
    dispatchPresent[f] = existsSync(join(dispatchDir, f));
    if (!dispatchPresent[f]) result.errors.push(`Dispatch artifact missing: ${f}`);
  }
  result.dispatch = { dir: dispatchDir, files: dispatchPresent };

  // Staging artifacts
  const stagingResultPath = join(root, getTurnStagingResultPath(turnId));
  if (!existsSync(stagingResultPath)) {
    result.errors.push('Staged turn-result.json missing');
    result.staging = { valid: false };
  } else {
    try {
      const turnResult = JSON.parse(readFileSync(stagingResultPath, 'utf8'));
      const hasRequiredFields = !!(
        turnResult.schema_version &&
        turnResult.run_id &&
        turnResult.turn_id &&
        turnResult.role &&
        turnResult.status &&
        Array.isArray(turnResult.decisions)
      );
      result.staging = {
        valid: hasRequiredFields,
        schema_version: turnResult.schema_version,
        role: turnResult.role,
        status: turnResult.status,
        decision_count: turnResult.decisions?.length || 0,
        objection_count: turnResult.objections?.length || 0,
      };
      if (!hasRequiredFields) result.errors.push('Turn result missing required governed fields');
    } catch {
      result.errors.push('Staged turn-result.json is not valid JSON');
      result.staging = { valid: false };
    }
  }

  return result;
}

/**
 * Validate state, history, and decision ledger AFTER acceptance.
 */
function validatePostAcceptanceArtifacts(root) {
  const result = { state: null, history: null, ledger: null, errors: [] };

  // State
  const statePath = join(root, '.agentxchain/state.json');
  if (!existsSync(statePath)) {
    result.errors.push('state.json missing after acceptance');
  } else {
    try {
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      result.state = {
        valid: !!(state.run_id && state.schema_version && state.status && state.phase),
        status: state.status,
        sha256: sha256(readFileSync(statePath, 'utf8')),
      };
      if (!result.state.valid) result.errors.push('state.json missing required fields');
    } catch {
      result.errors.push('state.json is not valid JSON');
    }
  }

  // History
  const historyPath = join(root, '.agentxchain/history.jsonl');
  if (!existsSync(historyPath)) {
    result.errors.push('history.jsonl missing after acceptance');
  } else {
    const entries = readJsonl(historyPath);
    result.history = {
      valid: entries.length >= 1 && !!entries[0].turn_id && !!entries[0].role,
      entry_count: entries.length,
    };
    if (!result.history.valid) result.errors.push('history.jsonl has no valid entries');
  }

  // Decision ledger
  const ledgerPath = join(root, '.agentxchain/decision-ledger.jsonl');
  if (!existsSync(ledgerPath)) {
    result.errors.push('decision-ledger.jsonl missing after acceptance');
  } else {
    const entries = readJsonl(ledgerPath);
    result.ledger = {
      valid: entries.length >= 1,
      entry_count: entries.length,
    };
    if (!result.ledger.valid) result.errors.push('decision-ledger.jsonl has no entries');
  }

  return result;
}

function finish(root, errors, ctx) {
  const passed = errors.length === 0;

  // Cleanup
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {}

  outputResult({
    runner: 'live-governed-proof',
    runner_interface_version: RUNNER_INTERFACE_VERSION,
    result: passed ? 'pass' : 'fail',
    provider,
    model: MODEL_MAP[provider],
    run_id: ctx.runId,
    turn_id: ctx.turnId,
    attempts_used: ctx.attemptsUsed || 1,
    usage: ctx.usage || null,
    artifacts: ctx.artifacts
      ? {
          state: ctx.artifacts.state,
          history: ctx.artifacts.history,
          ledger: ctx.artifacts.ledger,
          dispatch: ctx.artifacts.dispatch ? { files: ctx.artifacts.dispatch.files } : null,
          staging: ctx.artifacts.staging,
        }
      : null,
    errors: errors.length > 0 ? errors : undefined,
  });

  process.exit(passed ? 0 : 1);
}

function outputResult(data) {
  if (jsonMode) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  } else {
    if (data.result === 'skip') {
      process.stdout.write(`Live Governed Proof — SKIPPED: ${data.reason}\n`);
      return;
    }

    const lines = [
      `Live Governed Proof — AgentXchain runner-interface v${RUNNER_INTERFACE_VERSION}`,
      `  Provider: ${data.provider || 'unknown'}`,
      `  Model:    ${data.model || 'unknown'}`,
      `  Init:     ${data.run_id ? 'ok' : 'FAIL'} (run_id: ${data.run_id || 'none'})`,
      `  Assign:   ${data.turn_id ? 'ok' : 'FAIL'} (turn_id: ${data.turn_id || 'none'}, role: qa)`,
      `  Dispatch: ${data.usage ? 'ok' : 'FAIL'}`,
    ];
    if (data.usage) {
      lines.push(`  Usage:    ${data.usage.input_tokens} in / ${data.usage.output_tokens} out ($${data.usage.usd})`);
    }
    if (data.artifacts) {
      lines.push('  Artifacts:');
      lines.push(`    state.json:            ${data.artifacts.state?.valid ? 'valid' : 'INVALID'}`);
      lines.push(`    history.jsonl:         ${data.artifacts.history?.valid ? 'valid' : 'INVALID'} (${data.artifacts.history?.entry_count || 0} entries)`);
      lines.push(`    decision-ledger.jsonl: ${data.artifacts.ledger?.valid ? 'valid' : 'INVALID'} (${data.artifacts.ledger?.entry_count || 0} entries)`);
      if (data.artifacts.dispatch?.files) {
        const df = data.artifacts.dispatch.files;
        lines.push(`    dispatch audit:        ${Object.values(df).every(Boolean) ? 'complete' : 'INCOMPLETE'}`);
      }
      if (data.artifacts.staging) {
        lines.push(`    turn-result.json:      ${data.artifacts.staging.valid ? 'valid' : 'INVALID'} (${data.artifacts.staging.decision_count} decisions, ${data.artifacts.staging.objection_count} objections)`);
      }
    }
    if (data.errors?.length > 0) {
      lines.push('  Errors:');
      for (const e of data.errors) lines.push(`    - ${e}`);
    }
    lines.push(`  Result: ${data.result === 'pass' ? 'PASS' : 'FAIL'} — ${data.result === 'pass' ? 'one governed turn executed against real LLM, all artifacts valid' : 'proof failed'}`);
    process.stdout.write(lines.join('\n') + '\n');
  }
}

main();
