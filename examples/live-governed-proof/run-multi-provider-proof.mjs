#!/usr/bin/env node

/**
 * Live multi-provider governed proof.
 *
 * This executes a two-phase governed workflow:
 *   1. PM review via OpenAI api_proxy
 *   2. Human approval of planning_signoff
 *   3. QA review via Anthropic api_proxy
 *   4. Human approval of qa_ship_verdict
 *
 * Scope truth:
 *   - proves governed orchestration across two providers
 *   - does not prove provider-authored repo writes
 *   - both api_proxy roles remain review_only by contract
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const cliRoot = join(repoRoot, 'cli');

const {
  initRun,
  loadState,
  getActiveTurn,
  assignTurn,
  acceptTurn,
  rejectTurn,
  approvePhaseGate,
  approveCompletionGate,
  writeDispatchBundle,
  getTurnStagingResultPath,
  RUNNER_INTERFACE_VERSION,
} = await import(join(cliRoot, 'src', 'lib', 'runner-interface.js'));

const { dispatchApiProxy } = await import(
  join(cliRoot, 'src', 'lib', 'adapters', 'api-proxy-adapter.js')
);

const jsonMode = process.argv.includes('--json');
const openaiBaseUrl = getArgValue('--openai-base-url');
const anthropicBaseUrl = getArgValue('--anthropic-base-url');

const REQUIRED_ENVS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];
const missingEnvs = REQUIRED_ENVS.filter((name) => !process.env[name]);

if (missingEnvs.length > 0) {
  outputResult({
    result: 'skip',
    reason: `Live multi-provider proof requires ${missingEnvs.join(', ')}`,
    missing_env: missingEnvs,
  });
  process.exit(0);
}

const MODELS = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5-20251001',
};

const PROVIDER_BY_ROLE = {
  pm: 'openai',
  qa: 'anthropic',
};

const MAX_ATTEMPTS = 3;

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function makeConfig() {
  const runtimes = {
    'openai-pm': {
      type: 'api_proxy',
      provider: 'openai',
      model: MODELS.openai,
      auth_env: 'OPENAI_API_KEY',
      max_output_tokens: 2048,
      timeout_seconds: 60,
    },
    'anthropic-qa': {
      type: 'api_proxy',
      provider: 'anthropic',
      model: MODELS.anthropic,
      auth_env: 'ANTHROPIC_API_KEY',
      max_output_tokens: 2048,
      timeout_seconds: 60,
    },
  };

  if (openaiBaseUrl) {
    runtimes['openai-pm'].base_url = openaiBaseUrl;
  }

  if (anthropicBaseUrl) {
    runtimes['anthropic-qa'].base_url = anthropicBaseUrl;
  }

  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: {
      id: 'live-multi-provider-proof',
      name: 'Live Multi Provider Proof',
      default_branch: 'main',
    },
    roles: {
      pm: {
        title: 'Product Manager',
        mandate: 'Review seeded planning artifacts and challenge scope quality.',
        write_authority: 'review_only',
        runtime_class: 'api_proxy',
        runtime_id: 'openai-pm',
      },
      qa: {
        title: 'QA',
        mandate: 'Review seeded QA artifacts and challenge ship readiness.',
        write_authority: 'review_only',
        runtime_class: 'api_proxy',
        runtime_id: 'anthropic-qa',
      },
    },
    runtimes,
    routing: {
      planning: {
        entry_role: 'pm',
        allowed_next_roles: ['qa', 'human'],
        exit_gate: 'planning_signoff',
      },
      qa: {
        entry_role: 'qa',
        allowed_next_roles: ['human'],
        exit_gate: 'qa_ship_verdict',
      },
    },
    gates: {
      planning_signoff: {
        requires_files: [
          '.planning/PM_SIGNOFF.md',
          '.planning/ROADMAP.md',
          '.planning/SYSTEM_SPEC.md',
        ],
        requires_human_approval: true,
      },
      qa_ship_verdict: {
        requires_files: [
          '.planning/acceptance-matrix.md',
          '.planning/ship-verdict.md',
          '.planning/RELEASE_NOTES.md',
        ],
        requires_human_approval: true,
      },
    },
    budget: {
      per_turn_max_usd: 1.0,
      per_run_max_usd: 5.0,
    },
    rules: {
      challenge_required: true,
      max_turn_retries: 2,
      max_deadlock_cycles: 1,
    },
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

const PM_PROMPT = `# PM Review Prompt

You are the PM review role in a governed AgentXchain run.

Review the seeded planning artifacts and return ONLY valid JSON.

Requirements:
1. Raise at least one objection.
2. Include at least one decision.
3. You are review_only, so files_changed and artifacts_created must both be [].
4. phase_transition_request must be "qa".
5. proposed_next_role must be "human".
6. run_completion_request must be null.

Return exactly one JSON object with this shape:
{"schema_version":"1.0","run_id":"FILL_FROM_ASSIGNMENT","turn_id":"FILL_FROM_ASSIGNMENT","role":"pm","runtime_id":"openai-pm","status":"completed","summary":"FILL","decisions":[{"id":"DEC-001","category":"scope","statement":"FILL","rationale":"FILL"}],"objections":[{"id":"OBJ-001","severity":"low","statement":"FILL","status":"raised"}],"files_changed":[],"artifacts_created":[],"verification":{"status":"pass","commands":[],"evidence_summary":"Reviewed seeded planning artifacts.","machine_evidence":[]},"artifact":{"type":"review","ref":null},"proposed_next_role":"human","phase_transition_request":"qa","run_completion_request":null,"needs_human_reason":null,"cost":{"input_tokens":0,"output_tokens":0,"usd":0}}
`;

const QA_PROMPT = `# QA Review Prompt

You are the QA review role in a governed AgentXchain run.

Review the seeded QA gate artifacts and return ONLY valid JSON.

Requirements:
1. Raise at least one objection.
2. Include at least one decision.
3. You are review_only, so files_changed and artifacts_created must both be [].
4. run_completion_request must be true.
5. proposed_next_role must be "human".
6. phase_transition_request must be null.

Return exactly one JSON object with this shape:
{"schema_version":"1.0","run_id":"FILL_FROM_ASSIGNMENT","turn_id":"FILL_FROM_ASSIGNMENT","role":"qa","runtime_id":"anthropic-qa","status":"completed","summary":"FILL","decisions":[{"id":"DEC-001","category":"quality","statement":"FILL","rationale":"FILL"}],"objections":[{"id":"OBJ-001","severity":"low","statement":"FILL","status":"raised"}],"files_changed":[],"artifacts_created":[],"verification":{"status":"pass","commands":[],"evidence_summary":"Reviewed seeded QA artifacts.","machine_evidence":[]},"artifact":{"type":"review","ref":null},"proposed_next_role":"human","phase_transition_request":null,"run_completion_request":true,"needs_human_reason":null,"cost":{"input_tokens":0,"output_tokens":0,"usd":0}}
`;

function scaffoldProject(root) {
  const config = makeConfig();
  mkdirSync(join(root, '.agentxchain', 'prompts'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });

  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2) + '\n');
  writeFileSync(join(root, 'TALK.md'), '# Talk\n');
  writeFileSync(
    join(root, '.agentxchain', 'state.json'),
    JSON.stringify(
      {
        schema_version: '1.1',
        project_id: 'live-multi-provider-proof',
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
      2
    ) + '\n'
  );
  writeFileSync(join(root, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'prompts', 'pm.md'), PM_PROMPT);
  writeFileSync(join(root, '.agentxchain', 'prompts', 'qa.md'), QA_PROMPT);

  seedPlanningArtifacts(root);
  seedQaArtifacts(root);

  return config;
}

function seedPlanningArtifacts(root) {
  writeFileSync(
    join(root, '.planning', 'PM_SIGNOFF.md'),
    '# PM Signoff\n\nApproved: YES\n\nScope is intentionally narrow for multi-provider governed proof.\n'
  );
  writeFileSync(
    join(root, '.planning', 'ROADMAP.md'),
    '# Roadmap\n\n## Goal\n\nValidate one governed run across OpenAI and Anthropic review roles.\n\n## Acceptance Criteria\n\n- PM review requests transition to QA\n- QA review requests run completion\n- Both human approval gates pass\n'
  );
  writeFileSync(
    join(root, '.planning', 'SYSTEM_SPEC.md'),
    '# System Spec\n\n## Purpose\n\nValidate governed multi-provider review orchestration.\n\n## Interface\n\n- PM review on OpenAI\n- QA review on Anthropic\n- Human approval at both gates\n\n## Acceptance Tests\n\n- [ ] PM review pauses for planning_signoff\n- [ ] QA review pauses for qa_ship_verdict\n- [ ] Final state is completed\n'
  );
}

function seedQaArtifacts(root) {
  writeFileSync(
    join(root, '.planning', 'acceptance-matrix.md'),
    '# Acceptance Matrix\n\n| Req # | Requirement | Acceptance criteria | Test status | Last tested | Status |\n|-------|-------------|---------------------|-------------|-------------|--------|\n| 1 | PM review can request QA transition | OpenAI PM turn reaches pending planning_signoff approval | pass | governed proof seed | pass |\n| 2 | QA review can request run completion | Anthropic QA turn reaches pending qa_ship_verdict approval | pass | governed proof seed | pass |\n| 3 | Final gate can complete the run | Human approval completes the governed run | pass | governed proof seed | pass |\n'
  );
  writeFileSync(
    join(root, '.planning', 'ship-verdict.md'),
    '# Ship Verdict\n\n## Verdict: YES\n\nThis seeded proof surface is ready for ship approval if both provider-backed review turns and both gate approvals succeed.\n'
  );
  writeFileSync(
    join(root, '.planning', 'RELEASE_NOTES.md'),
    '# Release Notes\n\n## User Impact\n\nAdds a governed multi-provider proof harness.\n\n## Verification Summary\n\n- OpenAI PM review should request QA\n- Anthropic QA review should request run completion\n'
  );
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readJsonl(path) {
  const content = readFileSync(path, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map((line) => JSON.parse(line));
}

function validateTurnArtifacts(root, turnId, provider) {
  const dispatchDir = join(root, '.agentxchain', 'dispatch', 'turns', turnId);
  const stagingDir = join(root, '.agentxchain', 'staging', turnId);
  const dispatchFiles = ['PROMPT.md', 'CONTEXT.md', 'ASSIGNMENT.json', 'API_REQUEST.json'];
  const errors = [];
  const files = {};

  for (const name of dispatchFiles) {
    const present = existsSync(join(dispatchDir, name));
    files[name] = present;
    if (!present) {
      errors.push(`Missing dispatch artifact for ${turnId}: ${name}`);
    }
  }

  const providerResponsePath = join(stagingDir, 'provider-response.json');
  const turnResultPath = join(root, getTurnStagingResultPath(turnId));
  const providerResponsePresent = existsSync(providerResponsePath);
  const turnResultPresent = existsSync(turnResultPath);

  if (!providerResponsePresent) {
    errors.push(`Missing provider-response.json for ${turnId}`);
  }

  if (!turnResultPresent) {
    errors.push(`Missing turn-result.json for ${turnId}`);
  }

  let requestSummary = null;
  if (files['API_REQUEST.json']) {
    try {
      const request = readJson(join(dispatchDir, 'API_REQUEST.json'));
      requestSummary = {
        provider: request.provider,
        model: request.model,
        endpoint: request.endpoint,
      };
      if (request.provider !== provider) {
        errors.push(`Expected provider ${provider} for ${turnId}, got ${request.provider}`);
      }
    } catch (error) {
      errors.push(`Invalid API_REQUEST.json for ${turnId}: ${error.message}`);
    }
  }

  let providerResponse = null;
  if (providerResponsePresent) {
    try {
      providerResponse = readJson(providerResponsePath);
    } catch (error) {
      errors.push(`Invalid provider-response.json for ${turnId}: ${error.message}`);
    }
  }

  let turnResult = null;
  if (turnResultPresent) {
    try {
      turnResult = readJson(turnResultPath);
      if (!turnResult.schema_version || !turnResult.role || !turnResult.status) {
        errors.push(`turn-result.json missing governed fields for ${turnId}`);
      }
    } catch (error) {
      errors.push(`Invalid turn-result.json for ${turnId}: ${error.message}`);
    }
  }

  return {
    errors,
    dispatch: files,
    request: requestSummary,
    provider_response_present: providerResponsePresent,
    provider_response_type: providerResponse?.type || providerResponse?.object || null,
    turn_result: turnResult
      ? {
          role: turnResult.role,
          status: turnResult.status,
          phase_transition_request: turnResult.phase_transition_request ?? null,
          run_completion_request: turnResult.run_completion_request ?? null,
          decision_count: Array.isArray(turnResult.decisions) ? turnResult.decisions.length : 0,
          objection_count: Array.isArray(turnResult.objections) ? turnResult.objections.length : 0,
        }
      : null,
  };
}

async function executeRole(root, config, roleId) {
  const provider = PROVIDER_BY_ROLE[roleId];
  const assignResult = assignTurn(root, config, roleId);
  if (!assignResult.ok) {
    return { ok: false, error: `assignTurn failed for ${roleId}: ${assignResult.error}` };
  }

  let lastUsage = null;
  let lastArtifacts = null;
  let turnId = assignResult.turn?.turn_id || null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const state = loadState(root, config);
    const activeTurn = getActiveTurn(state);
    if (!activeTurn) {
      return { ok: false, error: `No active turn found for ${roleId} on attempt ${attempt}` };
    }
    turnId = activeTurn.turn_id;

    const bundleResult = writeDispatchBundle(root, state, config);
    if (!bundleResult.ok) {
      return { ok: false, error: `writeDispatchBundle failed for ${roleId}: ${bundleResult.error}` };
    }

    const dispatchResult = await dispatchApiProxy(root, state, config, {
      skipManifestVerification: true,
    });
    if (!dispatchResult.ok) {
      const detail = dispatchResult.classified
        ? `${dispatchResult.classified.error_class}: ${dispatchResult.classified.message}`
        : dispatchResult.error || 'Unknown dispatch error';
      return { ok: false, error: `dispatchApiProxy failed for ${roleId}: ${detail}` };
    }

    lastUsage = dispatchResult.usage || null;
    lastArtifacts = validateTurnArtifacts(root, turnId, provider);
    if (lastArtifacts.errors.length > 0) {
      return { ok: false, error: lastArtifacts.errors.join('; ') };
    }

    const acceptResult = acceptTurn(root, config);
    if (acceptResult.ok) {
      return {
        ok: true,
        role: roleId,
        provider,
        turn_id: turnId,
        attempts_used: attempt,
        usage: lastUsage,
        artifacts: lastArtifacts,
        accepted_state: {
          status: acceptResult.state.status,
          phase: acceptResult.state.phase,
          pending_phase_transition: acceptResult.state.pending_phase_transition || null,
          pending_run_completion: acceptResult.state.pending_run_completion || null,
        },
      };
    }

    if (attempt === MAX_ATTEMPTS) {
      return {
        ok: false,
        error: `acceptTurn failed for ${roleId} after ${MAX_ATTEMPTS} attempts: ${acceptResult.error}`,
      };
    }

    const rejectResult = rejectTurn(
      root,
      config,
      null,
      `Validation retry for ${roleId} attempt ${attempt}: ${acceptResult.error}`
    );
    if (!rejectResult.ok) {
      return { ok: false, error: `rejectTurn failed for ${roleId}: ${rejectResult.error}` };
    }
  }

  return { ok: false, error: `Unexpected retry loop exit for ${roleId}` };
}

async function main() {
  const root = join(tmpdir(), `axc-multi-provider-${randomBytes(6).toString('hex')}`);
  mkdirSync(root, { recursive: true });

  const errors = [];
  let runId = null;
  let pmProof = null;
  let qaProof = null;
  let finalState = null;
  let history = [];
  let ledger = [];

  try {
    const config = scaffoldProject(root);

    const runResult = initRun(root, config);
    if (!runResult.ok) {
      errors.push(`initRun failed: ${runResult.error}`);
      return finish(root, errors, {
        run_id: runId,
        pm: pmProof,
        qa: qaProof,
        final_state: finalState,
        history,
        ledger,
      });
    }
    runId = runResult.state.run_id;

    pmProof = await executeRole(root, config, 'pm');
    if (!pmProof.ok) {
      errors.push(pmProof.error);
      return finish(root, errors, {
        run_id: runId,
        pm: pmProof,
        qa: qaProof,
        final_state: finalState,
        history,
        ledger,
      });
    }

    if (pmProof.artifacts.turn_result?.phase_transition_request !== 'qa') {
      errors.push('PM turn did not request phase_transition_request: "qa"');
      return finish(root, errors, {
        run_id: runId,
        pm: pmProof,
        qa: qaProof,
        final_state: finalState,
        history,
        ledger,
      });
    }

    let state = loadState(root, config);
    if (!state.pending_phase_transition || state.pending_phase_transition.to !== 'qa') {
      errors.push('Expected pending phase transition to qa after PM acceptance');
      return finish(root, errors, {
        run_id: runId,
        pm: pmProof,
        qa: qaProof,
        final_state: finalState,
        history,
        ledger,
      });
    }

    const approvePlanning = approvePhaseGate(root, config);
    if (!approvePlanning.ok) {
      errors.push(`approvePhaseGate failed: ${approvePlanning.error}`);
      return finish(root, errors, {
        run_id: runId,
        pm: pmProof,
        qa: qaProof,
        final_state: finalState,
        history,
        ledger,
      });
    }

    qaProof = await executeRole(root, config, 'qa');
    if (!qaProof.ok) {
      errors.push(qaProof.error);
      return finish(root, errors, {
        run_id: runId,
        pm: pmProof,
        qa: qaProof,
        final_state: finalState,
        history,
        ledger,
      });
    }

    if (qaProof.artifacts.turn_result?.run_completion_request !== true) {
      errors.push('QA turn did not request run_completion_request: true');
      return finish(root, errors, {
        run_id: runId,
        pm: pmProof,
        qa: qaProof,
        final_state: finalState,
        history,
        ledger,
      });
    }

    state = loadState(root, config);
    if (!state.pending_run_completion || state.pending_run_completion.gate !== 'qa_ship_verdict') {
      errors.push('Expected pending run completion for qa_ship_verdict after QA acceptance');
      return finish(root, errors, {
        run_id: runId,
        pm: pmProof,
        qa: qaProof,
        final_state: finalState,
        history,
        ledger,
      });
    }

    const approveCompletion = approveCompletionGate(root, config);
    if (!approveCompletion.ok) {
      errors.push(`approveCompletionGate failed: ${approveCompletion.error}`);
      return finish(root, errors, {
        run_id: runId,
        pm: pmProof,
        qa: qaProof,
        final_state: finalState,
        history,
        ledger,
      });
    }

    finalState = loadState(root, config);
    history = readJsonl(join(root, '.agentxchain', 'history.jsonl'));
    ledger = readJsonl(join(root, '.agentxchain', 'decision-ledger.jsonl'));

    if (finalState.status !== 'completed') {
      errors.push(`Expected final state completed, got ${finalState.status}`);
    }
    if (finalState.phase_gate_status?.planning_signoff !== 'passed') {
      errors.push('planning_signoff gate did not end as passed');
    }
    if (finalState.phase_gate_status?.qa_ship_verdict !== 'passed') {
      errors.push('qa_ship_verdict gate did not end as passed');
    }
    if (history.length !== 2) {
      errors.push(`Expected exactly 2 history entries, got ${history.length}`);
    }
    if (history.length >= 2) {
      const roles = history.map((entry) => entry.role);
      if (roles[0] !== 'pm' || roles[1] !== 'qa') {
        errors.push(`Expected history roles [pm, qa], got [${roles.join(', ')}]`);
      }
    }
    if (ledger.length < 2) {
      errors.push(`Expected non-empty decision ledger, got ${ledger.length} entries`);
    }

    return finish(root, errors, {
      run_id: runId,
      pm: pmProof,
      qa: qaProof,
      final_state: {
        status: finalState.status,
        phase: finalState.phase,
        phase_gate_status: finalState.phase_gate_status,
      },
      history: {
        entry_count: history.length,
        roles: history.map((entry) => entry.role),
      },
      ledger: {
        entry_count: ledger.length,
      },
    });
  } catch (error) {
    errors.push(`Unexpected error: ${error.stack || error.message}`);
    return finish(root, errors, {
      run_id: runId,
      pm: pmProof,
      qa: qaProof,
      final_state: finalState,
      history,
      ledger,
    });
  }
}

function finish(root, errors, payload) {
  const passed = errors.length === 0;

  try {
    rmSync(root, { recursive: true, force: true });
  } catch {}

  outputResult({
    runner: 'live-multi-provider-governed-proof',
    runner_interface_version: RUNNER_INTERFACE_VERSION,
    result: passed ? 'pass' : 'fail',
    run_id: payload.run_id || null,
    providers: {
      openai: payload.pm || null,
      anthropic: payload.qa || null,
    },
    final_state: payload.final_state || null,
    history: payload.history || null,
    ledger: payload.ledger || null,
    errors: passed ? undefined : errors,
  });

  process.exit(passed ? 0 : 1);
}

function outputResult(data) {
  if (jsonMode) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
  }

  if (data.result === 'skip') {
    process.stdout.write(`Live Multi-Provider Governed Proof — SKIPPED: ${data.reason}\n`);
    return;
  }

  const lines = [
    `Live Multi-Provider Governed Proof — AgentXchain runner-interface v${RUNNER_INTERFACE_VERSION}`,
    `  Run:      ${data.run_id || 'none'}`,
    `  OpenAI:   ${data.providers?.openai?.turn_id || 'FAIL'} (${data.providers?.openai?.usage?.input_tokens || 0} in / ${data.providers?.openai?.usage?.output_tokens || 0} out)`,
    `  Anthropic:${data.providers?.anthropic?.turn_id || 'FAIL'} (${data.providers?.anthropic?.usage?.input_tokens || 0} in / ${data.providers?.anthropic?.usage?.output_tokens || 0} out)`,
    `  Final:    ${data.final_state?.status || 'unknown'} / phase ${data.final_state?.phase || 'unknown'}`,
    `  History:  ${data.history?.entry_count || 0} entries (${(data.history?.roles || []).join(', ')})`,
    `  Ledger:   ${data.ledger?.entry_count || 0} entries`,
  ];

  if (data.errors?.length) {
    lines.push('  Errors:');
    for (const error of data.errors) {
      lines.push(`    - ${error}`);
    }
  }

  lines.push(`  Result: ${data.result === 'pass' ? 'PASS' : 'FAIL'}`);
  process.stdout.write(lines.join('\n') + '\n');
}

main();
