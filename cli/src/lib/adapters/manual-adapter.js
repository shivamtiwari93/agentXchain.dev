/**
 * Manual adapter — the honest fallback.
 *
 * Per the frozen spec (§19, §8.2), the manual adapter:
 *   - dispatch: writes a prompt package and prints operator instructions
 *   - wait:    watches for the staged turn-result.json to appear (fs polling)
 *   - collect: reads the staged file (validation happens at the orchestrator level)
 *
 * This adapter is intentionally simple. It does not parse TALK.md, does not
 * auto-route, and does not pretend to be an orchestrator.
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import {
  getDispatchPromptPath,
  getTurnStagingResultPath,
} from '../turn-paths.js';

/**
 * Print operator instructions for a manual turn.
 *
 * @param {object} state - current governed state (must have current_turn)
 * @param {object} config - normalized config
 * @param {object} [options]
 * @param {string} [options.turnId]
 */
export function printManualDispatchInstructions(state, config, options = {}) {
  const turn = resolveTargetTurn(state, options.turnId);
  const role = config.roles?.[turn.assigned_role];
  const promptPath = getDispatchPromptPath(turn.turn_id);
  const stagingPath = getTurnStagingResultPath(turn.turn_id);
  const phase = state.phase || 'planning';
  const roleId = turn.assigned_role;

  const lines = [];
  lines.push('');
  lines.push('  +---------------------------------------------------------+');
  lines.push('  |  MANUAL TURN REQUIRED                                    |');
  lines.push('  |                                                          |');
  lines.push(`  |  Role:    ${pad(roleId, 46)}|`);
  lines.push(`  |  Turn:    ${pad(turn.turn_id, 46)}|`);
  lines.push(`  |  Phase:   ${pad(phase, 46)}|`);
  lines.push(`  |  Attempt: ${pad(String(turn.attempt), 46)}|`);
  lines.push('  |                                                          |');
  lines.push(`  |  Prompt:  ${pad(promptPath, 46)}|`);
  lines.push(`  |  Result:  ${pad(stagingPath, 46)}|`);
  lines.push('  +---------------------------------------------------------+');
  lines.push('');
  lines.push('  Steps:');
  lines.push(`    1. Read the prompt:   cat ${promptPath}`);
  lines.push('    2. Do the work described in the prompt');
  lines.push(`    3. Write turn-result.json to:  ${stagingPath}`);
  lines.push('    4. The step command will detect the file and proceed');
  lines.push('');

  // Phase-aware guidance
  const gateHints = getPhaseGateHints(phase, roleId, config);
  if (gateHints.length > 0) {
    lines.push('  Gate files to update this phase:');
    for (const hint of gateHints) {
      lines.push(`    - ${hint}`);
    }
    lines.push('');
  }

  // Minimal turn-result example
  lines.push('  Minimal turn-result.json:');
  lines.push('  {');
  lines.push('    "schema_version": "1.0",');
  lines.push(`    "run_id": "${state.run_id || 'run_...'}",`);
  lines.push(`    "turn_id": "${turn.turn_id}",`);
  lines.push(`    "role": "${roleId}",`);
  lines.push(`    "runtime_id": "${role?.runtime || 'manual'}",`);
  lines.push('    "status": "completed",');
  lines.push('    "summary": "...",');
  lines.push('    "decisions": [{"id":"DEC-001","category":"scope","statement":"...","rationale":"..."}],');
  lines.push('    "objections": [{"id":"OBJ-001","severity":"medium","statement":"...","status":"raised"}],');
  lines.push('    "files_changed": [],');
  lines.push('    "verification": {"status":"skipped","commands":[],"evidence_summary":"..."},');
  lines.push('    "artifact": {"type":"review","ref":null},');
  lines.push(`    "proposed_next_role": "${getDefaultNextRole(roleId, config)}",`);
  lines.push('    "phase_transition_request": null,');
  lines.push('    "run_completion_request": null');
  lines.push('  }');
  lines.push('');
  lines.push('  Docs: https://agentxchain.dev/docs/first-turn');
  lines.push('');

  return lines.join('\n');
}

/**
 * Return gate-file hints relevant to the current phase and role.
 */
function getPhaseGateHints(phase, roleId, config) {
  const hints = [];
  const gates = config.gates || {};

  if (phase === 'planning' && (roleId === 'pm' || roleId === 'human')) {
    hints.push('.planning/PM_SIGNOFF.md — change "Approved: NO" → "Approved: YES" when ready');
    hints.push('.planning/ROADMAP.md — define phases and acceptance criteria');
    hints.push('.planning/SYSTEM_SPEC.md — define ## Purpose, ## Interface, ## Acceptance Tests');
  } else if (phase === 'implementation' && (roleId === 'dev' || roleId === 'human')) {
    hints.push('.planning/IMPLEMENTATION_NOTES.md — record what you built and how to verify');
  } else if (phase === 'qa' && (roleId === 'qa' || roleId === 'human')) {
    hints.push('.planning/acceptance-matrix.md — mark each requirement PASS/FAIL');
    hints.push('.planning/ship-verdict.md — change "## Verdict: PENDING" → "## Verdict: SHIP"');
    hints.push('.planning/RELEASE_NOTES.md — user impact, verification summary, upgrade notes');
  }

  return hints;
}

/**
 * Suggest a reasonable next role based on current role.
 */
function getDefaultNextRole(roleId, config) {
  const routing = config.routing || {};
  if (routing[roleId]?.default_next) return routing[roleId].default_next;
  if (roleId === 'pm') return 'dev';
  if (roleId === 'dev') return 'qa';
  if (roleId === 'qa') return 'human';
  return 'human';
}

/**
 * Wait for the staged turn result file to appear.
 *
 * Uses polling with a configurable interval. Returns when the file exists
 * and is non-empty, or when the abort signal fires.
 *
 * @param {string} root - project root directory
 * @param {object} [options]
 * @param {number} [options.pollIntervalMs=2000] - polling interval in ms
 * @param {number} [options.timeoutMs=1200000] - max wait time (default: 20 min)
 * @param {AbortSignal} [options.signal] - abort signal to cancel waiting
 * @param {string} [options.turnId] - targeted turn id
 * @returns {Promise<{ found: boolean, timedOut: boolean, aborted: boolean }>}
 */
export async function waitForStagedResult(root, options = {}) {
  const {
    pollIntervalMs = 2000,
    timeoutMs = 1200000,
    signal,
    turnId,
  } = options;

  const stagingFile = join(root, getTurnStagingResultPath(turnId));
  const startTime = Date.now();

  return new Promise((resolve) => {
    // Check for abort signal
    if (signal?.aborted) {
      resolve({ found: false, timedOut: false, aborted: true });
      return;
    }

    const onAbort = () => {
      clearInterval(timer);
      resolve({ found: false, timedOut: false, aborted: true });
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    // Initial check
    if (isStagedResultReady(stagingFile)) {
      signal?.removeEventListener('abort', onAbort);
      resolve({ found: true, timedOut: false, aborted: false });
      return;
    }

    const timer = setInterval(() => {
      // Check timeout
      if (Date.now() - startTime >= timeoutMs) {
        clearInterval(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve({ found: false, timedOut: true, aborted: false });
        return;
      }

      // Check for file
      if (isStagedResultReady(stagingFile)) {
        clearInterval(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve({ found: true, timedOut: false, aborted: false });
      }
    }, pollIntervalMs);
  });
}

/**
 * Check if the staged result file exists and is non-empty.
 */
function isStagedResultReady(filePath) {
  try {
    if (!existsSync(filePath)) return false;
    const stat = statSync(filePath);
    return stat.size > 2; // Must be more than just "{}" or empty
  } catch {
    return false;
  }
}

/**
 * Read the staged result file without validation.
 *
 * @param {string} root - project root directory
 * @param {object} [options]
 * @param {string} [options.turnId]
 * @returns {{ ok: boolean, raw?: string, parsed?: object, error?: string }}
 */
export function readStagedResult(root, options = {}) {
  const stagingFile = join(root, getTurnStagingResultPath(options.turnId));
  try {
    const raw = readFileSync(stagingFile, 'utf8');
    const parsed = JSON.parse(raw);
    return { ok: true, raw, parsed };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function pad(str, width) {
  if (str.length >= width) return '...' + str.slice(-(width - 3));
  return str + ' '.repeat(width - str.length);
}

function resolveTargetTurn(state, turnId) {
  if (turnId && state?.active_turns?.[turnId]) {
    return state.active_turns[turnId];
  }
  return state?.current_turn || Object.values(state?.active_turns || {})[0];
}
