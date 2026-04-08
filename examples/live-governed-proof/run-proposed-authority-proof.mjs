#!/usr/bin/env node

/**
 * Live proposed-authority proof with a real Anthropic provider.
 *
 * This executes a governed workflow where a dev role with write_authority: "proposed"
 * dispatches to the real Anthropic API (claude-sonnet-4-6) and proves:
 *   1. Real model returns valid proposed_changes[]
 *   2. Proposals materialized under .agentxchain/proposed/<turn_id>/
 *   3. Proposed files are not treated as workspace truth before proposal apply
 *   4. proposal apply copies files to workspace
 *   5. A later real-model turn requests run completion after proposal apply
 *   6. Human-gated run completion succeeds
 *
 * Scope truth:
 *   - proves real-provider proposed-authority lifecycle end-to-end
 *   - uses Anthropic only (no OPENAI_API_KEY required)
 *   - does NOT prove multi-provider proposed authority
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

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
  approveCompletionGate,
  writeDispatchBundle,
  getTurnStagingResultPath,
} = await import(join(cliRoot, 'src', 'lib', 'runner-interface.js'));

const { dispatchApiProxy } = await import(
  join(cliRoot, 'src', 'lib', 'adapters', 'api-proxy-adapter.js')
);

const { applyProposal, listProposals } = await import(
  join(cliRoot, 'src', 'lib', 'proposal-ops.js')
);

const jsonMode = process.argv.includes('--json');
const anthropicBaseUrl = getArgValue('--anthropic-base-url');

const REQUIRED_ENVS = ['ANTHROPIC_API_KEY'];
const missingEnvs = REQUIRED_ENVS.filter((name) => !process.env[name]);

if (missingEnvs.length > 0) {
  outputResult({
    result: 'skip',
    reason: `Live proposed-authority proof requires ${missingEnvs.join(', ')}`,
    missing_env: missingEnvs,
  });
  process.exit(0);
}

const MODEL = 'claude-sonnet-4-6';
const MAX_ATTEMPTS = 3;

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function makeConfig() {
  const runtimes = {
    'anthropic-dev': {
      type: 'api_proxy',
      provider: 'anthropic',
      model: MODEL,
      auth_env: 'ANTHROPIC_API_KEY',
      max_output_tokens: 4096,
      timeout_seconds: 120,
    },
  };

  if (anthropicBaseUrl) {
    runtimes['anthropic-dev'].base_url = anthropicBaseUrl;
  }

  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: {
      id: 'live-proposed-authority-proof',
      name: 'Live Proposed Authority Proof',
      default_branch: 'main',
    },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement features using proposed authority. Return proposed_changes[] with file contents.',
        write_authority: 'proposed',
        runtime_class: 'api_proxy',
        runtime_id: 'anthropic-dev',
      },
    },
    runtimes,
    routing: {
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'human'],
        exit_gate: 'implementation_complete',
      },
    },
    gates: {
      implementation_complete: {
        requires_files: ['.planning/IMPLEMENTATION_NOTES.md'],
        requires_human_approval: true,
      },
    },
    budget: {
      per_turn_max_usd: 0.50,
      per_run_max_usd: 2.00,
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

const PROPOSAL_PROMPT = `# Developer Turn — Proposed Authority

You are the developer role in a governed AgentXchain run. You have **proposed** write authority.

Your task: propose creating an IMPLEMENTATION_NOTES.md file that documents a simple feature implementation.

You MUST return ONLY a single valid JSON object (no markdown, no explanation, no code fences).

Critical requirements:
1. Include at least one decision and one objection.
2. files_changed MUST be exactly [".planning/IMPLEMENTATION_NOTES.md"].
3. proposed_changes MUST be a non-empty array containing exactly one entry for ".planning/IMPLEMENTATION_NOTES.md" with the full file content.
3a. The proposed file content MUST contain the exact headings "## Changes" and "## Verification". Do NOT rename them, omit them, or replace them with "## Overview" / "## Architecture" only.
3b. Both "## Changes" and "## Verification" MUST contain real prose content, not placeholders and not empty sections.
4. phase_transition_request MUST be null (gate will be checked separately).
5. run_completion_request MUST be null.
6. status MUST be "completed".
7. proposed_next_role MUST be "human".
8. Do NOT mention, modify, or propose any path under ".agentxchain/", "staging/", "dispatch/", or any internal orchestration file. The ONLY allowed file path is ".planning/IMPLEMENTATION_NOTES.md".

Return exactly this JSON structure (fill in the FILL fields):
{"schema_version":"1.0","run_id":"FILL_FROM_CONTEXT","turn_id":"FILL_FROM_CONTEXT","role":"dev","runtime_id":"anthropic-dev","status":"completed","summary":"Proposed IMPLEMENTATION_NOTES.md documenting the governed proof implementation.","decisions":[{"id":"DEC-001","category":"implementation","statement":"Created implementation notes with the required gate-valid sections.","rationale":"The implementation exit gate requires real content under ## Changes and ## Verification."}],"objections":[{"id":"OBJ-001","severity":"low","statement":"Implementation scope is intentionally minimal for proof purposes.","status":"raised"}],"files_changed":[".planning/IMPLEMENTATION_NOTES.md"],"artifacts_created":[],"verification":{"status":"pass","commands":["echo verified"],"evidence_summary":"Implementation notes proposed for review.","machine_evidence":[{"command":"echo verified","exit_code":0}]},"artifact":{"type":"patch","ref":null},"proposed_next_role":"human","phase_transition_request":null,"run_completion_request":null,"needs_human_reason":null,"proposed_changes":[{"path":".planning/IMPLEMENTATION_NOTES.md","action":"create","content":"# Implementation Notes\\n\\n## Changes\\n\\n- Added a governed-proof implementation notes artifact for the proposed-authority live harness.\\n- Kept the scope intentionally narrow so the operator can review and apply a single planned file.\\n\\n## Verification\\n\\n- Confirmed the proposal is staged for operator review before apply.\\n- Confirmed the file is intended to satisfy the implementation gate only after proposal apply copies it into the workspace.\\n"}],"cost":{"input_tokens":0,"output_tokens":0,"usd":0}}
`;

const COMPLETION_PROMPT = `# Developer Turn — Completion Request

You are the developer role in a governed AgentXchain run. You have **proposed** write authority.

Context:
- .planning/IMPLEMENTATION_NOTES.md already exists in the workspace.
- Do NOT propose any new files or edits in this turn.
- This turn exists only to request governed run completion.

You MUST return ONLY a single valid JSON object (no markdown, no explanation, no code fences).

Critical requirements:
1. Include at least one decision and one objection.
2. files_changed MUST be an empty array.
3. proposed_changes MUST be an empty array.
4. phase_transition_request MUST be null.
5. run_completion_request MUST be true.
6. status MUST be "completed".
7. proposed_next_role MUST be "dev". Any other value will be rejected by validation.

Return exactly this JSON structure (fill in the FILL fields):
{"schema_version":"1.0","run_id":"FILL_FROM_CONTEXT","turn_id":"FILL_FROM_CONTEXT","role":"dev","runtime_id":"anthropic-dev","status":"completed","summary":"Requested governed run completion after proposal apply placed IMPLEMENTATION_NOTES.md in the workspace.","decisions":[{"id":"DEC-002","category":"completion","statement":"Requested run completion only after IMPLEMENTATION_NOTES.md was applied into the workspace.","rationale":"Completion must depend on workspace truth, not proposal-directory-only files."}],"objections":[{"id":"OBJ-002","severity":"low","statement":"This proof covers a narrow completion path rather than a broader multi-role workflow.","status":"raised"}],"files_changed":[],"artifacts_created":[],"verification":{"status":"pass","commands":["echo completion-ready"],"evidence_summary":"Workspace contains IMPLEMENTATION_NOTES.md and is ready for governed completion review.","machine_evidence":[{"command":"echo completion-ready","exit_code":0}]},"artifact":{"type":"review","ref":null},"proposed_next_role":"dev","phase_transition_request":null,"run_completion_request":true,"needs_human_reason":null,"proposed_changes":[],"cost":{"input_tokens":0,"output_tokens":0,"usd":0}}
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
        project_id: 'live-proposed-authority-proof',
        status: 'idle',
        phase: 'implementation',
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
  writeFileSync(join(root, '.agentxchain', 'prompts', 'dev.md'), PROPOSAL_PROMPT);

  // Seed planning artifacts that are prerequisites for being in implementation phase
  writeFileSync(
    join(root, '.planning', 'PM_SIGNOFF.md'),
    '# PM Signoff\n\nApproved: YES\n\nScope is narrow for proposed-authority proof.\n'
  );
  writeFileSync(
    join(root, '.planning', 'SYSTEM_SPEC.md'),
    '# System Spec\n\n## Purpose\n\nValidate proposed-authority lifecycle with real Anthropic provider.\n\n## Interface\n\n- Dev role with proposed write authority\n- Single Anthropic provider\n\n## Acceptance Tests\n\n- [ ] Dev proposes IMPLEMENTATION_NOTES.md\n- [ ] Gate fails before apply\n- [ ] Gate passes after apply\n- [ ] Run completes\n'
  );
  writeFileSync(
    join(root, '.planning', 'ROADMAP.md'),
    '# Roadmap\n\n## Goal\n\nProve real-provider proposed authority end to end.\n'
  );

  // Init git repo for baseline checks
  execSync('git init && git add -A && git commit -m "init"', {
    cwd: root,
    stdio: 'pipe',
    env: { ...process.env, GIT_AUTHOR_NAME: 'proof', GIT_COMMITTER_NAME: 'proof', GIT_AUTHOR_EMAIL: 'proof@test', GIT_COMMITTER_EMAIL: 'proof@test' },
  });

  return config;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readJsonl(path) {
  const content = readFileSync(path, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map((line) => JSON.parse(line));
}

function outputResult(data) {
  if (jsonMode) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  } else {
    const { result, ...rest } = data;
    console.log(`\n=== Live Proposed-Authority Proof: ${result.toUpperCase()} ===\n`);
    if (rest.reason) console.log(`Reason: ${rest.reason}`);
    if (rest.errors?.length) {
      console.log('Errors:');
      for (const e of rest.errors) console.log(`  - ${e}`);
    }
    if (rest.proof) {
      console.log('\nProof chain:');
      for (const [key, val] of Object.entries(rest.proof)) {
        console.log(`  ${key}: ${typeof val === 'object' ? JSON.stringify(val) : val}`);
      }
    }
  }
}

function writeDevPrompt(root, prompt) {
  writeFileSync(join(root, '.agentxchain', 'prompts', 'dev.md'), prompt);
}

function commitAll(root, message) {
  execSync(`git add -A && git commit -m ${JSON.stringify(message)}`, {
    cwd: root,
    stdio: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'proof',
      GIT_COMMITTER_NAME: 'proof',
      GIT_AUTHOR_EMAIL: 'proof@test',
      GIT_COMMITTER_EMAIL: 'proof@test',
    },
  });
}

function readStagedTurnResult(root, turnId) {
  const stagingPath = join(root, getTurnStagingResultPath(turnId));
  return JSON.parse(readFileSync(stagingPath, 'utf8'));
}

function validateProposalTurn(turnResult) {
  const errors = [];
  const hasSectionContent = (content, sectionHeader) => {
    const escapedHeader = sectionHeader.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = content.match(new RegExp(`${escapedHeader}\\s*\\n+([\\s\\S]*?)(?=\\n##\\s|$)`));
    if (!match) return false;
    return match[1]
      .split(/\r?\n/)
      .map((line) => line.trim())
      .some((line) => line && !/^\(.*fills this.*\)$/i.test(line));
  };

  if (turnResult.status !== 'completed') {
    errors.push(`status must be "completed" (got "${turnResult.status}")`);
  }
  if (turnResult.run_completion_request != null) {
    errors.push('run_completion_request must be null for the proposal turn');
  }
  if (!Array.isArray(turnResult.proposed_changes) || turnResult.proposed_changes.length !== 1) {
    errors.push('proposal turn must contain exactly one proposed change');
  } else {
    const [change] = turnResult.proposed_changes;
    if (change.path !== '.planning/IMPLEMENTATION_NOTES.md') {
      errors.push(`proposal turn must target only ".planning/IMPLEMENTATION_NOTES.md" (got "${change.path}")`);
    }
    if (typeof change.content !== 'string') {
      errors.push('proposal turn must include full content for ".planning/IMPLEMENTATION_NOTES.md"');
    } else {
      if (!change.content.includes('## Changes')) {
        errors.push('proposal turn content must include a "## Changes" section');
      }
      if (!change.content.includes('## Verification')) {
        errors.push('proposal turn content must include a "## Verification" section');
      }
      if (!hasSectionContent(change.content, '## Changes')) {
        errors.push('proposal turn "## Changes" section must contain real content');
      }
      if (!hasSectionContent(change.content, '## Verification')) {
        errors.push('proposal turn "## Verification" section must contain real content');
      }
    }
  }
  const filesChanged = turnResult.files_changed || [];
  if (filesChanged.length !== 1 || filesChanged[0] !== '.planning/IMPLEMENTATION_NOTES.md') {
    errors.push('proposal turn must list only ".planning/IMPLEMENTATION_NOTES.md" in files_changed');
  }
  if (filesChanged.some((file) => file.startsWith('.agentxchain/'))) {
    errors.push('proposal turn must not claim internal .agentxchain paths');
  }
  return errors;
}

function validateCompletionTurn(turnResult) {
  const errors = [];
  if (turnResult.status !== 'completed') {
    errors.push(`status must be "completed" (got "${turnResult.status}")`);
  }
  if (turnResult.run_completion_request !== true) {
    errors.push('completion turn must set run_completion_request to true');
  }
  if (turnResult.phase_transition_request != null) {
    errors.push('completion turn must not request a phase transition');
  }
  if ((turnResult.files_changed || []).length !== 0) {
    errors.push('completion turn must not declare files_changed');
  }
  if ((turnResult.proposed_changes || []).length !== 0) {
    errors.push('completion turn must not declare proposed_changes');
  }
  return errors;
}

async function dispatchWithRetry(root, config, roleId, validateScenario) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const state = loadState(root, config);
    const activeTurn = getActiveTurn(state);
    if (!activeTurn) {
      return { ok: false, error: `No active turn found for ${roleId} on attempt ${attempt}` };
    }
    const turnId = activeTurn.turn_id;

    const bundleResult = writeDispatchBundle(root, state, config);
    if (!bundleResult.ok) {
      return { ok: false, error: `writeDispatchBundle failed: ${bundleResult.error}` };
    }

    const dispatchResult = await dispatchApiProxy(root, state, config, {
      skipManifestVerification: true,
    });
    if (!dispatchResult.ok) {
      const retryableExtractionFailure =
        dispatchResult.classified?.error_class === 'turn_result_extraction_failure';
      if (retryableExtractionFailure && attempt < MAX_ATTEMPTS) {
        lastError = `${dispatchResult.classified.error_class}: ${dispatchResult.classified.message}`;
        continue;
      }
      const detail = dispatchResult.classified
        ? `${dispatchResult.classified.error_class}: ${dispatchResult.classified.message}`
        : dispatchResult.error || 'Unknown dispatch error';
      return { ok: false, error: `dispatchApiProxy failed: ${detail}` };
    }

    const stagedTurnResult = readStagedTurnResult(root, turnId);
    const scenarioErrors = validateScenario ? validateScenario(stagedTurnResult) : [];
    if (scenarioErrors.length > 0) {
      lastError = `Scenario contract failed: ${scenarioErrors.join('; ')}`;
      if (attempt < MAX_ATTEMPTS) {
        const rejectResult = rejectTurn(root, config, null, `Validation retry attempt ${attempt}: ${lastError}`);
        if (!rejectResult.ok) {
          return { ok: false, error: `rejectTurn failed: ${rejectResult.error}` };
        }
        continue;
      }
      return { ok: false, error: `dispatch scenario failed after ${MAX_ATTEMPTS} attempts: ${scenarioErrors.join('; ')}` };
    }

    const acceptResult = acceptTurn(root, config);
    if (acceptResult.ok) {
      return {
        ok: true,
        turn_id: turnId,
        attempts_used: attempt,
        usage: dispatchResult.usage || null,
        accepted_state: {
          status: acceptResult.state.status,
          phase: acceptResult.state.phase,
          pending_phase_transition: acceptResult.state.pending_phase_transition || null,
          pending_run_completion: acceptResult.state.pending_run_completion || null,
          queued_phase_transition: acceptResult.state.queued_phase_transition || null,
          queued_run_completion: acceptResult.state.queued_run_completion || null,
        },
        completion_result: acceptResult.completionResult || null,
        gate_result: acceptResult.gateResult || null,
      };
    }

    lastError = acceptResult.error;

    if (attempt < MAX_ATTEMPTS) {
      const rejectResult = rejectTurn(
        root, config, null,
        `Validation retry attempt ${attempt}: ${acceptResult.error}`
      );
      if (!rejectResult.ok) {
        return { ok: false, error: `rejectTurn failed: ${rejectResult.error}` };
      }
    }
  }

  return { ok: false, error: `acceptTurn failed after ${MAX_ATTEMPTS} attempts: ${lastError}` };
}

async function main() {
  const root = join(tmpdir(), `axc-proposed-proof-${randomBytes(6).toString('hex')}`);
  mkdirSync(root, { recursive: true });

  const errors = [];
  const proof = {};

  try {
    // ── 1. Scaffold and init ──────────────────────────────────────────────
    const config = scaffoldProject(root);

    const runResult = initRun(root, config);
    if (!runResult.ok) {
      errors.push(`initRun failed: ${runResult.error}`);
      return outputResult({ result: 'fail', errors, proof });
    }
    proof.run_id = runResult.state.run_id;
    proof.initial_phase = runResult.state.phase;

    // ── 2. Assign dev turn ────────────────────────────────────────────────
    const assignResult = assignTurn(root, config, 'dev');
    if (!assignResult.ok) {
      errors.push(`assignTurn failed: ${assignResult.error}`);
      return outputResult({ result: 'fail', errors, proof });
    }
    proof.assigned_turn_id = assignResult.turn.turn_id;

    // ── 3. Dispatch to real Anthropic API ─────────────────────────────────
    const devResult = await dispatchWithRetry(root, config, 'dev', validateProposalTurn);
    if (!devResult.ok) {
      errors.push(devResult.error);
      return outputResult({ result: 'fail', errors, proof });
    }
    proof.dev_turn_id = devResult.turn_id;
    proof.dev_attempts = devResult.attempts_used;
    proof.dev_usage = devResult.usage;
    proof.dev_accepted_state = devResult.accepted_state;

    // ── 4. Verify proposals materialized ──────────────────────────────────
    const proposalDir = join(root, '.agentxchain', 'proposed', devResult.turn_id);
    const proposalExists = existsSync(proposalDir);
    proof.proposal_dir_exists = proposalExists;

    if (!proposalExists) {
      errors.push(`Proposal directory not materialized at ${proposalDir}`);
      return outputResult({ result: 'fail', errors, proof });
    }

    const proposals = listProposals(root);
    proof.proposal_count = proposals.proposals?.length || 0;
    proof.proposal_files = proposals.proposals?.[0]?.files || [];

    if (proof.proposal_count === 0) {
      errors.push('No proposals found after dev turn acceptance');
      return outputResult({ result: 'fail', errors, proof });
    }

    // ── 5. Verify proposal-only file is not yet workspace truth ───────────
    const implNotesInWorkspace = existsSync(join(root, '.planning', 'IMPLEMENTATION_NOTES.md'));
    proof.impl_notes_in_workspace_before_apply = implNotesInWorkspace;

    if (implNotesInWorkspace) {
      errors.push('IMPLEMENTATION_NOTES.md exists in workspace before proposal apply — expected only in proposed dir');
      return outputResult({ result: 'fail', errors, proof });
    }

    const implNotesInProposed = existsSync(join(proposalDir, '.planning', 'IMPLEMENTATION_NOTES.md'));
    proof.impl_notes_in_proposed_dir = implNotesInProposed;

    if (!implNotesInProposed) {
      errors.push('IMPLEMENTATION_NOTES.md not found in proposal directory');
      return outputResult({ result: 'fail', errors, proof });
    }

    // ── 6. Apply proposal ─────────────────────────────────────────────────
    const applyResult = applyProposal(root, devResult.turn_id, {});
    proof.proposal_apply = { ok: applyResult.ok, applied_files: applyResult.applied_files || [] };

    if (!applyResult.ok) {
      errors.push(`proposal apply failed: ${applyResult.error}`);
      return outputResult({ result: 'fail', errors, proof });
    }

    // Commit applied files so workspace is clean for next turn
    commitAll(root, 'apply proposal');

    // ── 7. Verify file now in workspace ───────────────────────────────────
    const implNotesAfterApply = existsSync(join(root, '.planning', 'IMPLEMENTATION_NOTES.md'));
    proof.impl_notes_in_workspace_after_apply = implNotesAfterApply;

    if (!implNotesAfterApply) {
      errors.push('IMPLEMENTATION_NOTES.md not in workspace after proposal apply');
      return outputResult({ result: 'fail', errors, proof });
    }

    // ── 8. Request run completion via second dev turn ─────────────────────
    writeDevPrompt(root, COMPLETION_PROMPT);
    commitAll(root, 'switch to completion prompt');

    const assign2 = assignTurn(root, config, 'dev');
    if (!assign2.ok) {
      errors.push(`Second assignTurn failed: ${assign2.error}`);
      return outputResult({ result: 'fail', errors, proof });
    }

    const dev2 = await dispatchWithRetry(root, config, 'dev', validateCompletionTurn);
    if (!dev2.ok) {
      errors.push(`Completion-request turn failed: ${dev2.error}`);
      return outputResult({ result: 'fail', errors, proof });
    }

    proof.completion_turn = {
      turn_id: dev2.turn_id,
      attempts: dev2.attempts_used,
      usage: dev2.usage,
      accepted_state: dev2.accepted_state,
      completion_result: dev2.completion_result,
      gate_result: dev2.gate_result,
    };

    const historyAfterCompletionRequest = readJsonl(join(root, '.agentxchain', 'history.jsonl'));
    const completionHistoryEntry = historyAfterCompletionRequest.find((entry) => entry.turn_id === dev2.turn_id) || null;
    proof.completion_turn_requested_run_completion = Boolean(completionHistoryEntry?.run_completion_request);
    proof.completion_turn_files_changed = completionHistoryEntry?.files_changed || [];
    proof.completion_turn_proposed_changes = completionHistoryEntry?.proposed_changes?.length || 0;

    if (!proof.completion_turn_requested_run_completion) {
      errors.push('Completion-request turn was accepted but did not set run_completion_request: true');
      return outputResult({ result: 'fail', errors, proof });
    }

    let state = loadState(root, config);
    proof.pending_run_completion_after_request = state.pending_run_completion || null;

    if (!state.pending_run_completion) {
      const completionAction = dev2.completion_result?.action || 'unknown';
      const completionReasons = dev2.completion_result?.reasons || [];
      const gateReasons = dev2.gate_result?.reasons || [];
      errors.push(
        `Run did not pause for pending run completion after completion-request turn (completion action: ${completionAction}${completionReasons.length ? `; reasons: ${completionReasons.join(' | ')}` : ''}${gateReasons.length ? `; gate reasons: ${gateReasons.join(' | ')}` : ''})`
      );
      return outputResult({ result: 'fail', errors, proof });
    }

    // ── 9. Approve run completion ─────────────────────────────────────────
    const completionResult = approveCompletionGate(root, config);
    proof.run_completion = { ok: completionResult.ok, error: completionResult.error || null };

    if (!completionResult.ok) {
      errors.push(`Run completion failed: ${completionResult.error}`);
      return outputResult({ result: 'fail', errors, proof });
    }

    // ── 10. Verify final state ────────────────────────────────────────────
    state = loadState(root, config);
    proof.final_status = state.status;
    proof.final_phase = state.phase;

    // ── 11. Verify decision ledger ────────────────────────────────────────
    const ledger = readJsonl(join(root, '.agentxchain', 'decision-ledger.jsonl'));
    const proposalEntries = ledger.filter(
      (e) => e.category === 'proposal' || (e.action && e.action.includes('applied'))
    );
    proof.ledger_proposal_entries = proposalEntries.length;
    proof.ledger_total_entries = ledger.length;

    // ── 12. Verify history ────────────────────────────────────────────────
    const history = readJsonl(join(root, '.agentxchain', 'history.jsonl'));
    const proposedTurns = history.filter((h) => h.write_authority === 'proposed');
    proof.history_proposed_turns = proposedTurns.length;
    proof.history_total_turns = history.length;

    // ── Result ────────────────────────────────────────────────────────────
    const coreAssertions = [
      proof.proposal_dir_exists,
      proof.proposal_count > 0,
      proof.impl_notes_in_proposed_dir,
      !proof.impl_notes_in_workspace_before_apply,
      proof.proposal_apply.ok,
      proof.impl_notes_in_workspace_after_apply,
      proof.completion_turn_requested_run_completion,
      proof.run_completion.ok,
      proof.final_status === 'completed',
    ];

    const allCorePassed = coreAssertions.every(Boolean);

    if (allCorePassed && errors.length === 0) {
      outputResult({ result: 'pass', proof, errors: [] });
    } else {
      outputResult({ result: 'fail', proof, errors });
    }
  } catch (err) {
    errors.push(`Unexpected error: ${err.message}`);
    outputResult({ result: 'fail', errors, proof, stack: err.stack });
  } finally {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // cleanup failure is non-fatal
    }
  }
}

main();
