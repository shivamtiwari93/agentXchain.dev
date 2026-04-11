/**
 * Dispatch bundle writer — materializes the filesystem handoff artifacts
 * for a governed turn assignment.
 *
 * Per the frozen spec (§46), a dispatch bundle lives at:
 *   .agentxchain/dispatch/turns/<turn_id>/
 *
 * And contains:
 *   - ASSIGNMENT.json  — machine-readable turn envelope
 *   - PROMPT.md        — rendered role prompt with protocol rules
 *   - CONTEXT.md       — execution context (state, last turn, blockers, gates)
 *
 * This module is a library primitive. The resume command and future
 * orchestrator turn loop call it after assignGovernedTurn().
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';
import { getActiveTurn, getActiveTurns } from './governed-state.js';
import { renderInheritedContextMarkdown } from './run-context-inheritance.js';
import {
  DISPATCH_INDEX_PATH,
  getDispatchAssignmentPath,
  getDispatchContextPath,
  getDispatchLogPath,
  getDispatchPromptPath,
  getReviewArtifactPath,
  getDispatchTurnDir,
  getTurnStagingResultPath,
} from './turn-paths.js';

const HISTORY_PATH = '.agentxchain/history.jsonl';
const FILE_PREVIEW_MAX_FILES = 5;
const FILE_PREVIEW_MAX_LINES = 120;
const PROPOSAL_SUMMARY_MAX_LINES = 80;
const GATE_FILE_PREVIEW_MAX_LINES = 60;
const DISPATCH_LOG_MAX_LINES = 50;
const DISPATCH_LOG_MAX_LINE_BYTES = 8192;

// Reserved paths that agents must never modify
const RESERVED_PATHS = [
  '.agentxchain/state.json',
  '.agentxchain/history.jsonl',
  '.agentxchain/decision-ledger.jsonl',
  '.agentxchain/lock.json',
];

/**
 * Write a dispatch bundle for the currently assigned turn.
 *
 * @param {string} root - project root directory
 * @param {object} state - current governed state (must have current_turn)
 * @param {object} config - normalized config
 * @param {object} [opts]
 * @param {string} [opts.turnId]
 * @param {string[]} [opts.warnings]
 * @returns {{ ok: boolean, error?: string, bundlePath?: string, warnings?: string[] }}
 */
export function writeDispatchBundle(root, state, config, opts = {}) {
  const targetTurn = resolveTargetTurn(state, opts.turnId);
  if (!targetTurn) {
    return { ok: false, error: 'No active turn in state — cannot write dispatch bundle' };
  }

  const turn = targetTurn;
  const roleId = turn.assigned_role;
  const role = config.roles?.[roleId];

  if (!role) {
    return { ok: false, error: `Role "${roleId}" not found in config` };
  }

  const phase = state.phase;
  const routing = config.routing?.[phase];
  const allowedNextRoles = routing?.allowed_next_roles || [];
  const exitGate = routing?.exit_gate;
  const gateConfig = exitGate ? config.gates?.[exitGate] : null;

  const bundleDir = join(root, getDispatchTurnDir(turn.turn_id));
  const warnings = [...(opts.warnings || [])];

  // Clear and recreate only the targeted turn bundle
  try {
    rmSync(bundleDir, { recursive: true, force: true });
  } catch (err) {
    return { ok: false, error: `Failed to clear existing dispatch bundle: ${err.message}` };
  }
  mkdirSync(bundleDir, { recursive: true });

  const activeTurns = getActiveTurns(state);
  const activeSiblings = Object.values(activeTurns)
    .filter((activeTurn) => activeTurn.turn_id !== turn.turn_id)
    .map((activeTurn) => ({
      turn_id: activeTurn.turn_id,
      role: activeTurn.assigned_role,
      status: activeTurn.status,
      assigned_sequence: activeTurn.assigned_sequence ?? null,
      declared_file_scope: activeTurn.declared_file_scope,
    }));

  // 1. ASSIGNMENT.json
  const assignment = {
    run_id: state.run_id,
    turn_id: turn.turn_id,
    phase,
    role: roleId,
    runtime_id: turn.runtime_id,
    write_authority: role.write_authority,
    accepted_integration_ref: state.accepted_integration_ref,
    staging_result_path: getTurnStagingResultPath(turn.turn_id),
    reserved_paths: RESERVED_PATHS,
    allowed_next_roles: allowedNextRoles,
    attempt: turn.attempt,
    deadline_at: turn.deadline_at,
    assigned_sequence: turn.assigned_sequence ?? null,
    budget_reservation_usd: state.budget_reservations?.[turn.turn_id]?.reserved_usd ?? null,
    active_siblings: activeSiblings,
  };
  if (turn.conflict_context) {
    assignment.conflict_context = turn.conflict_context;
  }
  if (warnings.length > 0) {
    assignment.advisory_warnings = warnings.map((message) => ({ code: 'advisory_scope_overlap', message }));
  }

  writeFileSync(
    join(root, getDispatchAssignmentPath(turn.turn_id)),
    JSON.stringify(assignment, null, 2) + '\n'
  );

  // 2. PROMPT.md
  const prompt = renderPrompt(role, roleId, turn, state, config, root);
  warnings.push(...prompt.warnings);
  writeFileSync(join(root, getDispatchPromptPath(turn.turn_id)), prompt.content);

  // 3. CONTEXT.md
  const context = renderContext(state, config, root, turn, role);
  warnings.push(...context.warnings);
  writeFileSync(join(root, getDispatchContextPath(turn.turn_id)), context.content);

  writeDispatchIndex(root, state, warningsByTurnId(state, turn.turn_id, warnings));

  return warnings.length
    ? { ok: true, bundlePath: bundleDir, warnings }
    : { ok: true, bundlePath: bundleDir };
}

// ── Prompt Rendering ────────────────────────────────────────────────────────

function renderPrompt(role, roleId, turn, state, config, root) {
  const phase = state.phase;
  const routing = config.routing?.[phase];
  const exitGate = routing?.exit_gate;
  const gateConfig = exitGate ? config.gates?.[exitGate] : null;
  const runtime = config.runtimes?.[turn.runtime_id];
  const runtimeType = runtime?.type || 'manual';
  const warnings = [];

  // Load custom prompt template from disk (best-effort)
  const promptPath = config.prompts?.[roleId];
  let customPrompt = '';
  if (promptPath) {
    try {
      const absPromptPath = join(root, promptPath);
      if (existsSync(absPromptPath)) {
        customPrompt = readFileSync(absPromptPath, 'utf8').trim();
      }
    } catch (err) {
      warnings.push(`Failed to load prompt template "${promptPath}": ${err.message}`);
    }
  }

  const lines = [];

  // Identity block
  lines.push(`# Turn Assignment: ${role.title} (${roleId})`);
  lines.push('');
  lines.push(`**Run:** ${state.run_id}`);
  lines.push(`**Turn:** ${turn.turn_id}`);
  lines.push(`**Phase:** ${phase}`);
  lines.push(`**Attempt:** ${turn.attempt}`);
  lines.push(`**Write Authority:** ${role.write_authority}`);
  lines.push(`**Runtime:** ${turn.runtime_id}`);
  lines.push('');

  // Mandate
  lines.push('## Your Mandate');
  lines.push('');
  lines.push(role.mandate);
  lines.push('');

  // Protocol rules
  lines.push('## Protocol Rules');
  lines.push('');
  lines.push('You MUST follow these rules:');
  lines.push('');
  lines.push('1. **Challenge the previous turn explicitly.** Do not rubber-stamp prior work.');
  lines.push('2. **Do not claim verification you did not perform.** If you did not run the tests, do not say they pass.');
  lines.push('3. **Do not modify reserved state files.** These are orchestrator-owned:');
  for (const p of RESERVED_PATHS) {
    lines.push(`   - \`${p}\``);
  }
  lines.push(`4. **Emit a structured turn result** to \`${getTurnStagingResultPath(turn.turn_id)}\`.`);
  lines.push('5. **Propose the next role**, but do not assume routing authority.');
  lines.push('');

  if (role.write_authority === 'review_only') {
    lines.push('### Write Authority: review_only');
    lines.push('');
    lines.push('- You may NOT modify product/code files.');
    lines.push('- You may create/modify files under `.planning/` and `.agentxchain/reviews/`.');
    lines.push('- Your artifact type must be `review`.');
    lines.push('- You MUST raise at least one objection (even if minor).');
    if (runtimeType === 'api_proxy' || runtimeType === 'remote_agent') {
      const reviewArtifactPath = getReviewArtifactPath(turn.turn_id, roleId);
      lines.push('- **This runtime cannot write repo files directly.** Do NOT claim `.planning/*` or `.agentxchain/reviews/*` changes you did not actually make.');
      lines.push(`- The orchestrator will materialize your accepted review at \`${reviewArtifactPath}\`.`);
      lines.push('- Use `summary`, `decisions`, `objections`, and `verification.evidence_summary` to communicate the review content.');
      lines.push('- Gate file contents and semantic status are shown in CONTEXT.md under "Gate Required Files". Check them before requesting run completion.');
    }
    lines.push('');
  } else if (role.write_authority === 'authoritative') {
    lines.push('### Write Authority: authoritative');
    lines.push('');
    lines.push('- You may directly modify repository files.');
    lines.push('- Your artifact type should be `workspace` or `commit`.');
    lines.push('- You must accurately declare all files you changed.');
    lines.push('');
  } else if (role.write_authority === 'proposed') {
    lines.push('### Write Authority: proposed');
    lines.push('');
    lines.push('- You may propose changes as patches but cannot directly commit.');
    lines.push('- Your artifact type should be `patch`.');
    if (runtimeType === 'api_proxy' || runtimeType === 'remote_agent') {
      lines.push('- **This runtime cannot write repo files directly.** When doing work, you MUST return proposed changes as structured JSON.');
      lines.push('- Include a `proposed_changes` array in your turn result with each file change (omit or set to `[]` on completion-only turns):');
      lines.push('  ```json');
      lines.push('  "proposed_changes": [');
      lines.push('    { "path": "src/lib/foo.js", "action": "create", "content": "// full file..." },');
      lines.push('    { "path": "src/lib/bar.js", "action": "modify", "content": "// full new content..." },');
      lines.push('    { "path": "src/old.js", "action": "delete" }');
      lines.push('  ]');
      lines.push('  ```');
      lines.push('- Valid actions: `create` (new file), `modify` (replace content), `delete` (remove file).');
      lines.push('- `content` is required for `create` and `modify` actions.');
      lines.push('- The orchestrator will materialize your proposal to `.agentxchain/proposed/<turn_id>/` for review.');
      lines.push('- List all proposed file paths in `files_changed`.');
    }
    lines.push('');
  }

  const workflowResponsibilities = getWorkflowPromptResponsibilities(config, phase, roleId, root);
  if (workflowResponsibilities.length > 0) {
    const isReviewOnlyOwner = role.write_authority === 'review_only';
    lines.push('## Workflow-Kit Responsibilities');
    lines.push('');
    if (isReviewOnlyOwner) {
      lines.push(`You are accountable for reviewing and attesting to these workflow-kit artifacts in phase \`${phase}\`:`);
    } else {
      lines.push(`You are accountable for producing these workflow-kit artifacts in phase \`${phase}\`:`);
    }
    lines.push('');
    for (const artifact of workflowResponsibilities) {
      const requiredLabel = artifact.required ? 'required' : 'optional';
      const semanticsLabel = artifact.semantics ? `\`${artifact.semantics}\`` : '—';
      lines.push(`- \`${artifact.path}\` — ${requiredLabel}; semantics: ${semanticsLabel}; status: ${artifact.status}`);
    }
    lines.push('');
    if (isReviewOnlyOwner) {
      lines.push('You cannot write repo files directly. Your accountability means you must confirm these artifacts exist, meet quality standards, and satisfy their semantic requirements. If a required artifact you own is missing, escalate to the producing role — do not request phase transition.');
    } else {
      lines.push('Do not request phase transition or run completion while a required workflow-kit artifact you own is missing or incomplete.');
    }
    lines.push('');
  }

  // Gate requirements
  if (gateConfig) {
    lines.push('## Phase Exit Gate');
    lines.push('');
    lines.push(`Gate: \`${exitGate}\``);
    lines.push('');
    if (gateConfig.requires_files) {
      lines.push('Required files:');
      for (const f of gateConfig.requires_files) {
        lines.push(`- \`${f}\``);
      }
    }
    if (gateConfig.requires_verification_pass) {
      lines.push('- Requires verification pass');
    }
    if (gateConfig.requires_human_approval) {
      lines.push('- Requires human approval');
    }
    lines.push('');
  }

  // Retry context
  if (turn.attempt > 1 && turn.last_rejection) {
    lines.push('## Previous Attempt Failed');
    lines.push('');
    lines.push(`This is attempt ${turn.attempt}. The previous attempt was rejected:`);
    lines.push('');
    lines.push(`- **Reason:** ${turn.last_rejection.reason}`);
    lines.push(`- **Failed stage:** ${turn.last_rejection.failed_stage}`);
    if (turn.last_rejection.validation_errors?.length) {
      lines.push('- **Errors:**');
      for (const err of turn.last_rejection.validation_errors) {
        lines.push(`  - ${err}`);
      }
    }
    lines.push('');
    lines.push('Fix the issues above before proceeding.');
    lines.push('');
  }

  if (turn.conflict_context) {
    lines.push('## File Conflict - Retry Required');
    lines.push('');
    lines.push('Your prior attempt conflicted with work accepted after your assignment.');
    lines.push('');
    if (turn.conflict_context.conflicting_files?.length) {
      lines.push('Conflicting files:');
      for (const file of turn.conflict_context.conflicting_files) {
        lines.push(`- \`${file}\``);
      }
      lines.push('');
    }
    if (turn.conflict_context.accepted_turns_since?.length) {
      lines.push('Accepted turns since assignment:');
      for (const acceptedTurn of turn.conflict_context.accepted_turns_since) {
        lines.push(`- \`${acceptedTurn.turn_id}\` (${acceptedTurn.role}) touched: ${acceptedTurn.files_changed.join(', ') || '(none)'}`);
      }
      lines.push('');
    }
    if (turn.conflict_context.non_conflicting_files_preserved?.length) {
      lines.push('Non-conflicting files to preserve from your prior attempt:');
      for (const file of turn.conflict_context.non_conflicting_files_preserved) {
        lines.push(`- \`${file}\``);
      }
      lines.push('');
    }
    lines.push(turn.conflict_context.guidance || 'You MUST rebase your changes on top of the current workspace state before retrying.');
    lines.push('');
  }

  // Role-specific instructions (loaded from custom prompt file)
  if (customPrompt) {
    lines.push('## Role-Specific Instructions');
    lines.push('');
    lines.push(customPrompt);
    lines.push('');
  }

  // Output format with complete JSON template
  lines.push('## Required Output');
  lines.push('');
  lines.push('When your work is complete, write your structured turn result to:');
  lines.push('');
  lines.push('```');
  lines.push(getTurnStagingResultPath(turn.turn_id));
  lines.push('```');
  lines.push('');
  lines.push('The JSON **must** match this exact schema. The orchestrator validates every field.');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(buildTurnResultTemplate(state, turn, roleId, role), null, 2));
  lines.push('```');
  lines.push('');
  lines.push('### Field Rules');
  lines.push('');
  lines.push('- `schema_version`: always `"1.0"`');
  lines.push('- `run_id`, `turn_id`, `role`, `runtime_id`: must match the values above exactly');
  lines.push('- `status`: one of `completed`, `blocked`, `needs_human`, `failed`');
  lines.push('- `summary`: concise description of what you did this turn');
  lines.push('- `decisions[].id`: pattern `DEC-NNN` (increment from previous turn)');
  lines.push('- `decisions[].category`: one of `implementation`, `architecture`, `scope`, `process`, `quality`, `release`');
  lines.push('- `objections[].id`: pattern `OBJ-NNN`');
  lines.push('- `objections[].severity`: one of `low`, `medium`, `high`, `blocking`');
  lines.push('- `verification.status`: one of `pass`, `fail`, `skipped`');
  lines.push('- `verification.status: "pass"` is valid only when every `verification.machine_evidence[].exit_code` is `0`');
  lines.push('- Expected-failure checks must be wrapped in a verifier that exits `0` when the failure occurs as expected; do not list raw non-zero negative-case commands on a passing turn');
  lines.push('- `artifact.type`: one of `workspace`, `patch`, `commit`, `review`');
  lines.push('- `proposed_next_role`: must be in allowed_next_roles for current phase, or `human`');
  if (role.write_authority === 'review_only') {
    lines.push('- `objections`: **must be non-empty** (challenge requirement for review_only roles)');
  }
  // List valid phase names explicitly to prevent gate-name confusion
  const phaseNames = config.routing ? Object.keys(config.routing) : [];
  if (phaseNames.length > 0) {
    lines.push(`- \`phase_transition_request\`: set to a **phase name** when gate requirements are met, or \`null\`. Valid phases: ${phaseNames.map((p) => `\`"${p}"\``).join(', ')}`);
    lines.push('- **Do NOT use exit gate names** (e.g., `planning_signoff`, `implementation_complete`, `qa_ship_verdict`) as `phase_transition_request` values — those are gate identifiers, not phase names');
  } else {
    lines.push('- `phase_transition_request`: set to next phase name when gate requirements are met, or `null`');
  }
  lines.push('- `run_completion_request`: set to `true` only in the final phase when ready to ship, or `null`');
  lines.push('- `phase_transition_request` and `run_completion_request` are **mutually exclusive**');
  // Phase-specific guidance for authoritative roles
  if (role.write_authority === 'authoritative' && phaseNames.length > 0) {
    const currentPhase = state?.phase;
    const phaseIdx = currentPhase ? phaseNames.indexOf(currentPhase) : -1;
    if (phaseIdx >= 0 && phaseIdx < phaseNames.length - 1) {
      const nextPhase = phaseNames[phaseIdx + 1];
      const currentGate = config.routing?.[currentPhase]?.exit_gate;
      const gateClause = currentGate ? ` and the exit gate (\`${currentGate}\`) is satisfied` : '';
      lines.push(`- **You are in the \`${currentPhase}\` phase.** When your work is complete${gateClause}, set \`phase_transition_request: "${nextPhase}"\` to advance to the next phase.`);
    } else if (phaseIdx === phaseNames.length - 1) {
      lines.push(`- **You are in the \`${currentPhase}\` phase (final phase).** When ready to ship, set \`run_completion_request: true\` and \`phase_transition_request: null\`.`);
    }
  }
  // Phase-specific guidance for proposed roles
  if (role.write_authority === 'proposed' && phaseNames.length > 0) {
    const currentPhase = state?.phase;
    const phaseIdx = currentPhase ? phaseNames.indexOf(currentPhase) : -1;
    if (phaseIdx >= 0 && phaseIdx < phaseNames.length - 1) {
      const nextPhase = phaseNames[phaseIdx + 1];
      const currentGate = config.routing?.[currentPhase]?.exit_gate;
      const gateClause = currentGate ? ` and the exit gate (\`${currentGate}\`) is satisfied` : '';
      lines.push(`- **You are in the \`${currentPhase}\` phase (not final phase).** When your work is complete${gateClause}, set \`phase_transition_request: "${nextPhase}"\`.`);
    } else if (phaseIdx >= 0 && phaseIdx === phaseNames.length - 1) {
      lines.push(`- **You are in the \`${currentPhase}\` phase (final phase).** When ready to ship, set \`run_completion_request: true\` and \`phase_transition_request: null\`.`);
      if (runtimeType === 'api_proxy' || runtimeType === 'remote_agent') {
        lines.push('- **Completion turns must be no-op:** set `proposed_changes` to `[]` or omit it, set `files_changed` to `[]`, and set `artifact.type` to `"review"`. Do NOT propose file changes on a completion turn.');
      }
    }
  }
  // Phase-specific guidance for review_only roles (terminal phase ship readiness)
  if (role.write_authority === 'review_only' && phaseNames.length > 0) {
    const currentPhase = state?.phase;
    const isTerminal = currentPhase && phaseNames.indexOf(currentPhase) === phaseNames.length - 1;
    if (isTerminal) {
      lines.push(`- **You are in the \`${currentPhase}\` phase (final phase).**`);
      lines.push('- **If your review verdict is ship-ready (no blocking issues):** set `run_completion_request: true` and `status: "completed"`. This triggers the human approval gate — it does NOT bypass human review.');
      lines.push('- **If you found genuine blocking issues that prevent shipping:** set `status: "needs_human"` and explain the blockers in `needs_human_reason`.');
      lines.push('- Do NOT use `status: "needs_human"` to mean "human should approve the release." That is what `run_completion_request: true` is for.');
      lines.push('- Do NOT set `phase_transition_request` to the exit gate name.');
      if (runtimeType === 'api_proxy' || runtimeType === 'remote_agent') {
        lines.push('- `run_completion_request: true` does **not** mean this runtime wrote `.planning/acceptance-matrix.md`, `.planning/ship-verdict.md`, or `.planning/RELEASE_NOTES.md` for you.');
      }
    }
  }
  lines.push('');

  return {
    content: lines.join('\n') + '\n',
    warnings,
  };
}

function getWorkflowPromptResponsibilities(config, phase, roleId, root) {
  const artifacts = config?.workflow_kit?.phases?.[phase]?.artifacts;
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    return [];
  }

  const entryRole = config?.routing?.[phase]?.entry_role || null;
  const responsibilities = [];

  for (const artifact of artifacts) {
    if (!artifact?.path) {
      continue;
    }

    const owner = typeof artifact.owned_by === 'string' && artifact.owned_by
      ? artifact.owned_by
      : null;
    const responsibleRole = owner || entryRole;
    if (responsibleRole !== roleId) {
      continue;
    }

    const absPath = join(root, artifact.path);
    let exists = false;
    try {
      exists = existsSync(absPath);
    } catch {
      exists = false;
    }

    responsibilities.push({
      path: artifact.path,
      required: artifact.required !== false,
      semantics: artifact.semantics || null,
      status: exists ? 'exists' : 'MISSING',
    });
  }

  return responsibilities;
}

// ── Context Rendering ───────────────────────────────────────────────────────

function renderContext(state, config, root, turn, role) {
  const warnings = [];
  const lines = [];

  lines.push('# Execution Context');
  lines.push('');

  // State summary
  lines.push('## Current State');
  lines.push('');
  lines.push(`- **Run:** ${state.run_id}`);
  lines.push(`- **Status:** ${state.status}`);
  lines.push(`- **Phase:** ${state.phase}`);
  lines.push(`- **Integration ref:** ${state.accepted_integration_ref || 'none'}`);
  if (state.budget_status) {
    lines.push(`- **Budget spent:** $${(state.budget_status.spent_usd || 0).toFixed(2)}`);
    if (state.budget_status.remaining_usd != null) {
      lines.push(`- **Budget remaining:** $${state.budget_status.remaining_usd.toFixed(2)}`);
    }
  }
  lines.push('');

  // Inherited context from parent run (when --inherit-context was used)
  if (state.inherited_context) {
    // First turn gets the full rendering; subsequent turns get compact
    const isFirstTurn = !state.last_completed_turn_id;
    const inheritedMd = renderInheritedContextMarkdown(state.inherited_context, !isFirstTurn);
    if (inheritedMd) {
      lines.push(inheritedMd);
    }
  }

  // Last accepted turn summary
  if (state.last_completed_turn_id) {
    const lastTurn = readLastHistoryEntry(root, warnings);
    if (lastTurn) {
      lines.push('## Last Accepted Turn');
      lines.push('');
      lines.push(`- **Turn:** ${lastTurn.turn_id}`);
      lines.push(`- **Role:** ${lastTurn.role}`);
      lines.push(`- **Summary:** ${lastTurn.summary}`);
      if (lastTurn.decisions?.length) {
        lines.push('- **Decisions:**');
        for (const d of lastTurn.decisions) {
          lines.push(`  - ${d.id}: ${d.statement}`);
        }
      }
      if (lastTurn.objections?.length) {
        lines.push('- **Objections:**');
        for (const o of lastTurn.objections) {
          lines.push(`  - ${o.id} (${o.severity}): ${o.statement}`);
        }
      }
      lines.push('');

      // Files changed by the previous turn
      const filesChanged = lastTurn.files_changed;
      if (Array.isArray(filesChanged) && filesChanged.length > 0) {
        lines.push('### Files Changed');
        lines.push('');
        for (const f of filesChanged) {
          lines.push(`- \`${f}\``);
        }
        lines.push('');
      }

      const filePreviews = role?.write_authority === 'review_only'
        ? buildChangedFilePreviews(root, filesChanged)
        : [];
      if (filePreviews.length > 0) {
        lines.push('### Changed File Previews');
        lines.push('');
        for (const preview of filePreviews) {
          lines.push(`#### \`${preview.path}\``);
          lines.push('');
          lines.push('```');
          lines.push(preview.content);
          lines.push('```');
          if (preview.truncated) {
            lines.push('');
            lines.push(`_Preview truncated after ${FILE_PREVIEW_MAX_LINES} lines._`);
          }
          lines.push('');
        }
      }

      const proposalPreview = role?.write_authority === 'review_only'
        ? buildProposalArtifactPreview(root, lastTurn)
        : null;
      if (proposalPreview) {
        lines.push('### Proposed Artifact');
        lines.push('');
        lines.push(`- **Artifact ref:** \`${proposalPreview.artifactRef}\``);
        lines.push(`- **Proposed files:** ${proposalPreview.changeCount}`);
        lines.push('');
        lines.push('```');
        lines.push(proposalPreview.summary);
        lines.push('```');
        if (proposalPreview.summaryTruncated) {
          lines.push('');
          lines.push(`_Preview truncated after ${PROPOSAL_SUMMARY_MAX_LINES} lines._`);
        }
        lines.push('');

        if (proposalPreview.filePreviews.length > 0) {
          lines.push('### Proposed File Previews');
          lines.push('');
          for (const preview of proposalPreview.filePreviews) {
            lines.push(`#### \`${preview.path}\` (${preview.action})`);
            lines.push('');
            lines.push('```');
            lines.push(preview.content);
            lines.push('```');
            if (preview.truncated) {
              lines.push('');
              lines.push(`_Preview truncated after ${FILE_PREVIEW_MAX_LINES} lines._`);
            }
            lines.push('');
          }
        }
      }

      // Verification evidence from the previous turn
      // Use raw verification (has commands, machine_evidence, evidence_summary)
      // and supplement with normalized_verification status when available
      const v = lastTurn.verification;
      if (v && typeof v === 'object' && Object.keys(v).length > 0) {
        lines.push('### Verification');
        lines.push('');
        if (v.status) {
          lines.push(`- **Status:** ${v.status}`);
        }
        const nv = lastTurn.normalized_verification;
        if (nv?.status && nv.status !== v.status) {
          lines.push(`- **Normalized status:** ${nv.status} — ${nv.reason || ''}`);
        }
        if (Array.isArray(v.commands) && v.commands.length > 0) {
          lines.push('- **Commands:**');
          for (const cmd of v.commands) {
            lines.push(`  - \`${cmd}\``);
          }
        }
        if (v.evidence_summary) {
          lines.push(`- **Evidence summary:** ${v.evidence_summary}`);
        }
        if (Array.isArray(v.machine_evidence) && v.machine_evidence.length > 0) {
          lines.push('- **Machine evidence:**');
          lines.push('');
          lines.push('  | Command | Exit Code |');
          lines.push('  |---------|-----------|');
          for (const me of v.machine_evidence) {
            lines.push(`  | \`${me.command || '(unknown)'}\` | ${me.exit_code ?? '?'} |`);
          }
        }
        lines.push('');
      }

      // Dispatch log excerpt for review-only turns
      if (role?.write_authority === 'review_only' && lastTurn.turn_id) {
        const logExcerpt = buildDispatchLogExcerpt(root, lastTurn.turn_id);
        if (logExcerpt) {
          lines.push('### Dispatch Log Excerpt');
          lines.push('');
          if (logExcerpt.truncated) {
            lines.push(`_Log truncated — showing last ${DISPATCH_LOG_MAX_LINES} lines of ${logExcerpt.totalLines} total._`);
            lines.push('');
          }
          lines.push('```');
          lines.push(logExcerpt.content);
          lines.push('```');
          lines.push('');
        }
      }

      // Observed artifact from the previous turn
      const obs = lastTurn.observed_artifact;
      if (obs && typeof obs === 'object') {
        const obsFiles = obs.files_changed;
        if (Array.isArray(obsFiles) && obsFiles.length > 0) {
          lines.push('### Observed Artifact');
          lines.push('');
          lines.push(`- **Files observed:** ${obsFiles.length}`);
          if (typeof obs.lines_added === 'number' || typeof obs.lines_removed === 'number') {
            lines.push(`- **Lines added:** ${obs.lines_added ?? 0}`);
            lines.push(`- **Lines removed:** ${obs.lines_removed ?? 0}`);
          }
          lines.push('');
        }
      }
    }
  }

  // Blockers / escalation
  if (state.blocked_on) {
    lines.push('## Blockers');
    lines.push('');
    lines.push(`- **Blocked on:** ${state.blocked_on}`);
    lines.push('');
  }

  if (state.escalation) {
    lines.push('## Escalation');
    lines.push('');
    lines.push(`- **From:** ${state.escalation.from_role}`);
    lines.push(`- **Reason:** ${state.escalation.reason}`);
    lines.push('');
  }

  // Workflow-kit artifacts for the current phase
  const phase = state.phase;
  const wkArtifacts = config?.workflow_kit?.phases?.[phase]?.artifacts;
  if (Array.isArray(wkArtifacts) && wkArtifacts.length > 0) {
    lines.push('## Workflow Artifacts');
    lines.push('');
    lines.push(`Current phase **${phase}** declares the following artifacts:`);
    lines.push('');
    lines.push('| Artifact | Required | Semantics | Owner | Status |');
    lines.push('|----------|----------|-----------|-------|--------|');
    const isReviewRole = role?.write_authority === 'review_only';
    const reviewPreviews = [];
    for (const art of wkArtifacts) {
      if (!art?.path) continue;
      const absPath = join(root, art.path);
      let exists = false;
      try { exists = existsSync(absPath); } catch { /* treat as missing */ }
      const req = art.required !== false ? 'yes' : 'no';
      const owner = art.owned_by || '—';
      const status = exists ? 'exists' : 'MISSING';
      const semCol = art.semantics ? `\`${art.semantics}\`` : '—';
      lines.push(`| \`${art.path}\` | ${req} | ${semCol} | ${owner} | ${status} |`);
      if (isReviewRole && exists) {
        reviewPreviews.push(art);
      }
    }
    lines.push('');
    if (reviewPreviews.length > 0) {
      for (const art of reviewPreviews) {
        const absPath = join(root, art.path);
        const preview = buildGateFilePreview(absPath);
        if (preview) {
          lines.push(`### \`${art.path}\``);
          lines.push('');
          const semantic = extractGateFileSemantic(art.path, preview.raw);
          if (semantic) {
            lines.push(`**Semantic: ${semantic}**`);
            lines.push('');
          }
          lines.push('```');
          lines.push(preview.content);
          lines.push('```');
          if (preview.truncated) {
            lines.push('');
            lines.push(`_Preview truncated after ${GATE_FILE_PREVIEW_MAX_LINES} lines._`);
          }
          lines.push('');
        }
      }
    }
  }

  // Phase gate requirements
  const routing = config.routing?.[phase];
  const exitGate = routing?.exit_gate;
  const gateConfig = exitGate ? config.gates?.[exitGate] : null;

  if (gateConfig?.requires_files) {
    lines.push('## Gate Required Files');
    lines.push('');
    const isReviewRole = role?.write_authority === 'review_only';
    for (const f of gateConfig.requires_files) {
      const absPath = join(root, f);
      const exists = existsSync(absPath);
      if (isReviewRole) {
        lines.push(`### \`${f}\` — ${exists ? 'exists' : 'MISSING'}`);
        lines.push('');
        if (exists) {
          const gatePreview = buildGateFilePreview(absPath);
          if (gatePreview) {
            // Semantic annotations for known gate files
            const semantic = extractGateFileSemantic(f, gatePreview.raw);
            if (semantic) {
              lines.push(`**Gate semantic: ${semantic}**`);
              lines.push('');
            }
            lines.push('```');
            lines.push(gatePreview.content);
            lines.push('```');
            if (gatePreview.truncated) {
              lines.push('');
              lines.push(`_Preview truncated after ${GATE_FILE_PREVIEW_MAX_LINES} lines._`);
            }
            lines.push('');
          }
        }
      } else {
        lines.push(`- \`${f}\` — ${exists ? 'exists' : 'MISSING'}`);
      }
    }
    lines.push('');
  }

  // Phase gate status
  if (state.phase_gate_status) {
    lines.push('## Phase Gate Status');
    lines.push('');
    for (const [gate, status] of Object.entries(state.phase_gate_status)) {
      lines.push(`- \`${gate}\`: ${status}`);
    }
    lines.push('');
  }

  return {
    content: lines.join('\n') + '\n',
    warnings,
  };
}

function buildGateFilePreview(absPath) {
  let raw;
  try {
    raw = readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const truncated = lines.length > GATE_FILE_PREVIEW_MAX_LINES;
  const previewLines = truncated ? lines.slice(0, GATE_FILE_PREVIEW_MAX_LINES) : lines;
  return {
    raw,
    content: previewLines.join('\n').trimEnd(),
    truncated,
  };
}

function extractGateFileSemantic(relPath, raw) {
  const lower = relPath.toLowerCase();
  if (lower.endsWith('pm_signoff.md')) {
    const match = raw.match(/^Approved:\s*(YES|NO|PENDING)/im);
    if (match && match[1].toUpperCase() === 'YES') {
      return 'Approved: YES';
    }
    return 'approval not found';
  }
  if (lower.endsWith('ship-verdict.md')) {
    const match = raw.match(/^##\s*Verdict:\s*(YES|SHIP|SHIP IT|NO|PENDING)/im);
    if (match) {
      const val = match[1].toUpperCase();
      if (val === 'YES' || val === 'SHIP' || val === 'SHIP IT') {
        return `Verdict: ${match[1]}`;
      }
      return 'verdict not affirmative';
    }
    return 'verdict not affirmative';
  }
  return null;
}

function buildChangedFilePreviews(root, filesChanged) {
  if (!Array.isArray(filesChanged) || filesChanged.length === 0) {
    return [];
  }

  const previews = [];
  for (const relPath of filesChanged.slice(0, FILE_PREVIEW_MAX_FILES)) {
    const absPath = join(root, relPath);
    if (!existsSync(absPath)) {
      continue;
    }

    let raw;
    try {
      raw = readFileSync(absPath, 'utf8');
    } catch {
      continue;
    }

    const lines = raw.replace(/\r\n/g, '\n').split('\n');
    const truncated = lines.length > FILE_PREVIEW_MAX_LINES;
    const previewLines = truncated ? lines.slice(0, FILE_PREVIEW_MAX_LINES) : lines;
    previews.push({
      path: relPath,
      content: previewLines.join('\n').trimEnd(),
      truncated,
    });
  }

  return previews;
}

function buildProposalArtifactPreview(root, lastTurn) {
  const artifactRef = lastTurn?.artifact?.ref;
  if (typeof artifactRef !== 'string' || !artifactRef.startsWith('.agentxchain/proposed/')) {
    return null;
  }

  const absProposalDir = join(root, artifactRef);
  const summaryPath = join(absProposalDir, 'PROPOSAL.md');

  let summary = '';
  let summaryTruncated = false;

  if (existsSync(summaryPath)) {
    try {
      const raw = readFileSync(summaryPath, 'utf8');
      const lines = raw.replace(/\r\n/g, '\n').split('\n');
      summaryTruncated = lines.length > PROPOSAL_SUMMARY_MAX_LINES;
      summary = (summaryTruncated ? lines.slice(0, PROPOSAL_SUMMARY_MAX_LINES) : lines)
        .join('\n')
        .trimEnd();
    } catch {
      summary = '';
    }
  }

  const changeActions = extractProposalActions(summary);
  const materializedFiles = collectProposalFiles(absProposalDir);

  if (!summary) {
    const fallbackLines = [
      `# Proposed Changes — ${lastTurn.turn_id || '(unknown)'}`,
      '',
      lastTurn.summary || '(no summary)',
      '',
    ];
    for (const filePath of materializedFiles) {
      fallbackLines.push(`- \`${filePath}\` — ${changeActions.get(filePath) || 'create'}`);
    }
    summary = fallbackLines.join('\n');
  }

  const filePreviews = [];
  for (const relPath of materializedFiles.slice(0, FILE_PREVIEW_MAX_FILES)) {
    const absPath = join(absProposalDir, relPath);

    let raw;
    try {
      raw = readFileSync(absPath, 'utf8');
    } catch {
      continue;
    }

    const lines = raw.replace(/\r\n/g, '\n').split('\n');
    const truncated = lines.length > FILE_PREVIEW_MAX_LINES;
    const previewLines = truncated ? lines.slice(0, FILE_PREVIEW_MAX_LINES) : lines;
    filePreviews.push({
      path: relPath,
      action: changeActions.get(relPath) || 'create',
      content: previewLines.join('\n').trimEnd(),
      truncated,
    });
  }

  return {
    artifactRef,
    summary,
    summaryTruncated,
    filePreviews,
    changeCount: changeActions.size || materializedFiles.length,
  };
}

function extractProposalActions(summary) {
  const actions = new Map();
  if (!summary) {
    return actions;
  }

  const matches = summary.matchAll(/^- `([^`]+)` — ([a-z]+)/gm);
  for (const match of matches) {
    actions.set(match[1], match[2]);
  }
  return actions;
}

function collectProposalFiles(absProposalDir, relPrefix = '') {
  if (!existsSync(absProposalDir)) {
    return [];
  }

  const files = [];
  for (const entry of readdirSync(absProposalDir, { withFileTypes: true })) {
    if (entry.name === 'PROPOSAL.md') {
      continue;
    }

    const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    const absPath = join(absProposalDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectProposalFiles(absPath, relPath));
    } else if (entry.isFile()) {
      files.push(relPath);
    }
  }
  return files.sort();
}

function buildDispatchLogExcerpt(root, turnId) {
  const logPath = join(root, getDispatchLogPath(turnId));
  if (!existsSync(logPath)) {
    return null;
  }

  let raw;
  try {
    raw = readFileSync(logPath, 'utf8');
  } catch {
    return null;
  }

  if (!raw || raw.trim().length === 0) {
    return null;
  }

  const allLines = raw.replace(/\r\n/g, '\n').split('\n');
  // Remove trailing empty line from split
  if (allLines.length > 0 && allLines[allLines.length - 1] === '') {
    allLines.pop();
  }

  const totalLines = allLines.length;
  if (totalLines === 0) {
    return null;
  }

  const truncated = totalLines > DISPATCH_LOG_MAX_LINES;
  const selectedLines = truncated
    ? allLines.slice(totalLines - DISPATCH_LOG_MAX_LINES)
    : allLines;

  // Per-line byte cap
  const cappedLines = selectedLines.map((line) => {
    if (Buffer.byteLength(line, 'utf8') > DISPATCH_LOG_MAX_LINE_BYTES) {
      return line.slice(0, DISPATCH_LOG_MAX_LINE_BYTES) + '…';
    }
    return line;
  });

  return {
    content: cappedLines.join('\n').trimEnd(),
    truncated,
    totalLines,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function resolveTargetTurn(state, turnId) {
  const activeTurns = getActiveTurns(state);
  if (turnId) {
    return activeTurns[turnId] || null;
  }
  return getActiveTurn(state) || state?.current_turn || null;
}

function warningsByTurnId(state, targetTurnId, targetWarnings) {
  const warningMap = {};
  for (const turnId of Object.keys(getActiveTurns(state))) {
    warningMap[turnId] = [];
  }
  if (targetTurnId && targetWarnings?.length) {
    warningMap[targetTurnId] = [...targetWarnings];
  }
  return warningMap;
}

function writeDispatchIndex(root, state, warningsByTurn = {}) {
  const activeTurns = getActiveTurns(state);
  const activeEntries = {};

  for (const [turnId, turn] of Object.entries(activeTurns)) {
    const turnWarnings = warningsByTurn[turnId] || [];
    activeEntries[turnId] = {
      turn_id: turnId,
      role: turn.assigned_role,
      runtime_id: turn.runtime_id,
      attempt: turn.attempt,
      status: turn.status,
      bundle_path: getDispatchTurnDir(turnId),
      staging_result_path: getTurnStagingResultPath(turnId),
      assigned_sequence: turn.assigned_sequence ?? null,
      advisory_warnings: turnWarnings.map((message) => ({
        code: 'advisory_scope_overlap',
        message,
      })),
    };
  }

  mkdirSync(join(root, '.agentxchain/dispatch'), { recursive: true });
  writeFileSync(
    join(root, DISPATCH_INDEX_PATH),
    JSON.stringify(
      {
        run_id: state.run_id,
        phase: state.phase,
        updated_at: new Date().toISOString(),
        active_turns: activeEntries,
      },
      null,
      2,
    ) + '\n',
  );
}

function readLastHistoryEntry(root, warnings = []) {
  const historyPath = join(root, HISTORY_PATH);
  if (!existsSync(historyPath)) return null;
  try {
    const content = readFileSync(historyPath, 'utf8').trim();
    if (!content) return null;
    const lines = content.split('\n');
    return JSON.parse(lines[lines.length - 1]);
  } catch (err) {
    warnings.push(`Failed to read ${HISTORY_PATH}: ${err.message}`);
    return null;
  }
}

// ── Turn Result Template ───────────────────────────────────────────────────

function buildTurnResultTemplate(state, turn, roleId, role) {
  const isReviewOnly = role.write_authority === 'review_only';
  return {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: turn.turn_id,
    role: roleId,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'TODO: describe what you accomplished this turn',
    decisions: [
      {
        id: 'DEC-001',
        category: 'implementation',
        statement: 'TODO: describe the decision',
        rationale: 'TODO: explain why',
      },
    ],
    objections: isReviewOnly
      ? [
          {
            id: 'OBJ-001',
            severity: 'medium',
            against_turn_id: state.last_completed_turn_id || 'TODO',
            statement: 'TODO: challenge the previous turn (required for review_only roles)',
            status: 'raised',
          },
        ]
      : [],
    files_changed: isReviewOnly ? [] : ['TODO: list every file you modified'],
    artifacts_created: [],
    verification: {
      status: isReviewOnly ? 'skipped' : 'pass',
      commands: isReviewOnly ? [] : ['TODO: list commands you ran'],
      evidence_summary: isReviewOnly
        ? 'Review turn — no verification commands required.'
        : 'TODO: describe what you verified',
      machine_evidence: isReviewOnly
        ? []
        : [{ command: 'TODO', exit_code: 0 }],
    },
    artifact: {
      type: isReviewOnly ? 'review' : 'workspace',
      ref: isReviewOnly ? null : 'git:dirty',
    },
    proposed_next_role: 'TODO',
    phase_transition_request: null,
    run_completion_request: null,
    needs_human_reason: null,
    cost: {
      input_tokens: 0,
      output_tokens: 0,
      usd: 0,
    },
  };
}

export { DISPATCH_INDEX_PATH, RESERVED_PATHS, getDispatchTurnDir, getTurnStagingResultPath };
