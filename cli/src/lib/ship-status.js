/**
 * M14: Shippability Visibility — Vision Closure (VISION.md:50)
 *
 * Composes five independent evidence dimensions into a single, operator-queryable
 * shippability assessment, answering "is this ready to ship?" without forcing the
 * operator to inspect run state, QA verdicts, gates, release artifacts, and test
 * evidence by hand.
 *
 * This module is a COMPOSITION layer (Architecture Invariant #1): it reaches the
 * existing governance logic through its public surface and never reimplements gate
 * evaluation, release alignment, or verification. It is strictly read-only
 * (Invariant #2) — it never mutates run state, artifacts, or config. Every
 * dimension is evaluated independently; a failure in one never short-circuits the
 * others (Invariant #3). Coordinator aggregation uses worst-case semantics
 * (Invariant #4).
 *
 * Public surface:
 *   evaluateShipStatus(repoDir, options)            — single governed repo
 *   evaluateCoordinatorShipStatus(coordDir, options) — multi-repo aggregation
 *   buildShipStatusSummary(artifact)                 — export-artifact summary (report.js)
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadProjectContext } from './config.js';
import { queryAcceptedTurnHistory } from './accepted-turn-history.js';
import { evaluateWorkflowGateSemantics, SHIP_VERDICT_PATH } from './workflow-gate-semantics.js';
import { validateReleaseAlignment } from './release-alignment.js';
import { loadCoordinatorConfig, resolveRepoPaths } from './coordinator-config.js';

export const SHIP_STATUS_DIMENSIONS = [
  'run_completion',
  'qa_ship_verdict',
  'gate_clearance',
  'release_alignment',
  'test_verification',
];

const DEFAULT_STATE_PATH = '.agentxchain/state.json';
const HISTORY_PATH = '.agentxchain/history.jsonl';

const PASSING_VERIFICATION = new Set(['pass', 'attested_pass']);
const PASSING_RUN_STATUSES = new Set(['completed']);
const FAILING_RUN_STATUSES = new Set(['failed', 'blocked', 'idle']);

function dimension(name, status, detail, blockingReason) {
  return {
    name,
    status,
    detail,
    blocking_reason: status === 'pass' ? null : (blockingReason || detail),
  };
}

/**
 * Read the governed state file WITHOUT writeback (loadProjectState may normalize
 * and persist, which would violate the read-only invariant).
 */
function readGovernedStateReadOnly(root, config) {
  const rel = config?.files?.state || DEFAULT_STATE_PATH;
  const filePath = join(root, rel);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// ── dimension evaluators (pure; exported for focused unit testing) ────────

/**
 * Dimension 1 — Run completion status. Source: governed run state `status`.
 */
export function evaluateRunCompletionDimension(state) {
  const status = state?.status || null;
  if (PASSING_RUN_STATUSES.has(status)) {
    return dimension('run_completion', 'pass', `Run status is "${status}".`, null);
  }
  if (FAILING_RUN_STATUSES.has(status)) {
    return dimension(
      'run_completion',
      'fail',
      `Run status is "${status}".`,
      `Run is not shippable: status "${status}".`,
    );
  }
  const label = status || 'unknown';
  return dimension(
    'run_completion',
    'pending',
    `Run status is "${label}"; not yet completed.`,
    `Run has not reached completion (status "${label}").`,
  );
}

function phaseOrder(config) {
  return Object.keys(config?.routing || {});
}

function finalPhaseReached(state, config) {
  const phases = phaseOrder(config);
  const finalPhase = phases.length ? phases[phases.length - 1] : 'qa';
  const currentPhase = state?.phase || null;
  if (state?.status === 'completed') return { reached: true, finalPhase };
  if (currentPhase == null) return { reached: false, finalPhase };
  const idx = phases.indexOf(currentPhase);
  const finalIdx = phases.indexOf(finalPhase);
  return { reached: idx >= 0 && idx >= finalIdx, finalPhase };
}

/**
 * Dimension 2 — QA ship verdict. Source: workflow-gate-semantics public surface
 * evaluated against .planning/ship-verdict.md (Architecture Invariant #1).
 */
export function evaluateShipVerdictDimension(root, state, config, semanticsEvaluator) {
  const evaluate = semanticsEvaluator || evaluateWorkflowGateSemantics;
  const result = evaluate(root, SHIP_VERDICT_PATH); // null when file missing, else { ok, reason? }
  const { reached, finalPhase } = finalPhaseReached(state, config);

  if (result == null) {
    if (reached) {
      return dimension(
        'qa_ship_verdict',
        'fail',
        `Ship verdict file ${SHIP_VERDICT_PATH} is missing.`,
        `QA ship verdict (${SHIP_VERDICT_PATH}) is missing after reaching the "${finalPhase}" phase.`,
      );
    }
    return dimension(
      'qa_ship_verdict',
      'pending',
      `QA ship verdict not yet produced (current phase "${state?.phase || 'unknown'}").`,
      `QA phase ("${finalPhase}") not yet reached; ship verdict pending.`,
    );
  }

  if (result.ok) {
    return dimension('qa_ship_verdict', 'pass', 'QA ship verdict is affirmative (## Verdict: YES).', null);
  }

  const reason = result.reason || 'Ship verdict is not affirmative.';
  return dimension('qa_ship_verdict', 'fail', reason, `QA did not approve shipping: ${reason}`);
}

/**
 * Dimension 3 — Gate clearance. Source: recorded phase_gate_status (string values
 * "passed"/"pending"/"failed") against the gates declared in config.
 */
export function evaluateGateClearanceDimension(state, config) {
  const gateIds = Object.keys(config?.gates || {});
  if (gateIds.length === 0) {
    return dimension(
      'gate_clearance',
      'pending',
      'No governance gates defined in config.',
      'No governance gates defined to evaluate.',
    );
  }

  const statusMap = state?.phase_gate_status || {};
  const perGate = gateIds.map((id) => ({ id, status: normalizeGateStatus(statusMap[id]) }));
  const failed = perGate.filter((g) => g.status === 'failed');
  const pending = perGate.filter((g) => g.status !== 'passed' && g.status !== 'failed');
  const detailParts = perGate.map((g) => `${g.id}=${g.status}`).join(', ');

  if (failed.length > 0) {
    return dimension(
      'gate_clearance',
      'fail',
      `Gate status: ${detailParts}.`,
      `Gate(s) failed: ${failed.map((g) => g.id).join(', ')}.`,
    );
  }
  if (pending.length > 0) {
    return dimension(
      'gate_clearance',
      'pending',
      `Gate status: ${detailParts}.`,
      `Gate(s) not yet satisfied: ${pending.map((g) => g.id).join(', ')}.`,
    );
  }
  return dimension('gate_clearance', 'pass', `All ${gateIds.length} gates passed.`, null);
}

// phase_gate_status values are strings in governed state, but tolerate the
// legacy { outcome | status } object shape defensively.
function normalizeGateStatus(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return value.outcome || value.status || 'pending';
  return 'pending';
}

/**
 * Dimension 4 — Release alignment. Source: release-alignment.validateReleaseAlignment.
 * The evaluator is injectable so composition can be tested without reconstructing
 * release-alignment's ~18 release surfaces (already covered by release-alignment.test.js).
 * When the release context cannot be built (pre-release, no package/changelog) the
 * dimension is pending rather than fail.
 */
export function evaluateReleaseAlignmentDimension(root, releaseEvaluator) {
  const evaluate = releaseEvaluator || ((repoRoot) => validateReleaseAlignment(repoRoot, {}));
  let result;
  try {
    result = evaluate(root);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return dimension(
      'release_alignment',
      'pending',
      `Release alignment not yet evaluable: ${message}`,
      `Release alignment not yet evaluated (pre-release): ${message}`,
    );
  }

  if (!result) {
    return dimension(
      'release_alignment',
      'pending',
      'Release alignment produced no result.',
      'Release alignment not yet evaluated.',
    );
  }

  if (result.ok) {
    const surfaces = result.checkedSurfaceCount ?? (result.checkedSurfaceIds?.length || 0);
    return dimension('release_alignment', 'pass', `Release alignment OK (${surfaces} surfaces checked).`, null);
  }

  const reasons = (result.errors || []).map((e) => e?.message || String(e));
  const preview = reasons.slice(0, 3).join('; ');
  const more = reasons.length > 3 ? ` (+${reasons.length - 3} more)` : '';
  return dimension(
    'release_alignment',
    'fail',
    `Release alignment failed: ${reasons.length} issue(s).`,
    `Release artifacts not aligned: ${preview}${more}.`,
  );
}

/**
 * Dimension 5 — Test verification. Source: verification.status across accepted turns.
 */
export function evaluateTestVerificationDimension(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return dimension(
      'test_verification',
      'pending',
      'No accepted turns with verification evidence yet.',
      'No accepted turns with verification evidence yet.',
    );
  }

  const failed = history.filter((h) => normalizeVerificationStatus(h) === 'fail');
  if (failed.length > 0) {
    const ids = failed.map((h) => h.turn_id).filter(Boolean).slice(0, 3).join(', ');
    return dimension(
      'test_verification',
      'fail',
      `${failed.length} accepted turn(s) failed verification.`,
      `Verification failed on turn(s): ${ids || '(unknown)'}.`,
    );
  }

  const nonPass = history.filter((h) => !PASSING_VERIFICATION.has(normalizeVerificationStatus(h)));
  if (nonPass.length > 0) {
    return dimension(
      'test_verification',
      'pending',
      `${nonPass.length} accepted turn(s) without a passing verification.`,
      `Verification not yet passing on ${nonPass.length} accepted turn(s).`,
    );
  }

  return dimension('test_verification', 'pass', `All ${history.length} accepted turns passed verification.`, null);
}

function normalizeVerificationStatus(entry) {
  const status = entry?.verification?.status;
  return typeof status === 'string' ? status.toLowerCase() : null;
}

/**
 * Aggregate dimension verdicts with worst-case semantics:
 * any fail → fail; else any pending → pending; else pass.
 */
export function aggregateShipStatus(dimensions) {
  const hasFail = dimensions.some((d) => d.status === 'fail');
  const hasPending = dimensions.some((d) => d.status === 'pending');
  const overall = hasFail ? 'fail' : hasPending ? 'pending' : 'pass';
  const passed = dimensions.filter((d) => d.status === 'pass').length;
  const blocking_reasons = dimensions
    .filter((d) => d.status !== 'pass')
    .map((d) => d.blocking_reason)
    .filter(Boolean);

  const blockingTag = blocking_reasons.length ? `, ${blocking_reasons.length} blocking` : '';
  const evidence_summary = `Ship status: ${overall.toUpperCase()} — ${passed}/${dimensions.length} dimensions pass${blockingTag}.`;

  return { overall, dimensions, blocking_reasons, evidence_summary };
}

// ── public API ────────────────────────────────────────────────────────────

/**
 * Compose the five evidence dimensions into a single ShipStatusReport.
 *
 * @param {string} repoDir
 * @param {object} [options]
 * @param {object} [options.context] - preloaded { root, config }
 * @param {object} [options.state] - preloaded run state
 * @param {Array}  [options.history] - preloaded accepted-turn history
 * @param {Function} [options.releaseAlignmentEvaluator] - (root) => { ok, errors }
 * @param {Function} [options.semanticsEvaluator] - (root, relPath) => { ok, reason? } | null
 * @returns {{ overall: string, dimensions: object[], blocking_reasons: string[], evidence_summary: string }}
 */
export function evaluateShipStatus(repoDir, options = {}) {
  const context = options.context || loadProjectContext(repoDir);
  if (!context) {
    const reason = `Not a governed AgentXchain project: no agentxchain.json found at ${repoDir}.`;
    return {
      overall: 'fail',
      dimensions: [],
      blocking_reasons: [reason],
      evidence_summary: `Ship status: FAIL — ${reason}`,
    };
  }

  const { root, config } = context;
  const state = options.state || readGovernedStateReadOnly(root, config) || {};
  const history = options.history || queryAcceptedTurnHistory(root);

  const dimensions = [
    evaluateRunCompletionDimension(state),
    evaluateShipVerdictDimension(root, state, config, options.semanticsEvaluator),
    evaluateGateClearanceDimension(state, config),
    evaluateReleaseAlignmentDimension(root, options.releaseAlignmentEvaluator),
    evaluateTestVerificationDimension(history),
  ];

  return aggregateShipStatus(dimensions);
}

/**
 * Aggregate per-repo shippability for a multi-repo coordinator run.
 *
 * @param {string} coordinatorDir
 * @param {object} [options] - dimension-evaluator overrides forwarded to each repo
 * @returns {{ overall: string, repos: object[], blocking_repos: string[], evidence_summary: string }}
 */
export function evaluateCoordinatorShipStatus(coordinatorDir, options = {}) {
  const loaded = options.coordinatorConfig
    ? { ok: true, config: options.coordinatorConfig, errors: [] }
    : loadCoordinatorConfig(coordinatorDir);

  if (!loaded.ok || !loaded.config) {
    const reason = `Cannot load coordinator config: ${(loaded.errors || []).join('; ') || 'unknown error'}`;
    return {
      overall: 'fail',
      repos: [],
      blocking_repos: [],
      evidence_summary: `Coordinator ship status: FAIL — ${reason}`,
    };
  }

  const { resolved } = resolveRepoPaths(loaded.config, coordinatorDir);
  const repoIds = loaded.config.repo_order || Object.keys(loaded.config.repos || {});

  // Only dimension-evaluator overrides are forwarded; per-repo state/context/history
  // must be loaded fresh for each repo.
  const forwarded = {
    releaseAlignmentEvaluator: options.releaseAlignmentEvaluator,
    semanticsEvaluator: options.semanticsEvaluator,
  };

  const repos = repoIds.map((repo_id) => {
    const repoPath = resolved[repo_id];
    if (!repoPath) {
      const reason = `repo "${repo_id}" path could not be resolved.`;
      return {
        repo_id,
        ship_status: {
          overall: 'fail',
          dimensions: [],
          blocking_reasons: [reason],
          evidence_summary: `Ship status: FAIL — ${reason}`,
        },
      };
    }
    return { repo_id, ship_status: evaluateShipStatus(repoPath, forwarded) };
  });

  const hasFail = repos.some((r) => r.ship_status.overall === 'fail');
  const hasPending = repos.some((r) => r.ship_status.overall === 'pending');
  const overall = hasFail ? 'fail' : hasPending ? 'pending' : 'pass';
  const blocking_repos = repos
    .filter((r) => r.ship_status.overall !== 'pass')
    .map((r) => r.repo_id);
  const passed = repos.filter((r) => r.ship_status.overall === 'pass').length;
  const blockingTag = blocking_repos.length ? `, blocking: ${blocking_repos.join(', ')}` : '';
  const evidence_summary = `Coordinator ship status: ${overall.toUpperCase()} — ${passed}/${repos.length} repos shippable${blockingTag}.`;

  return { overall, repos, blocking_repos, evidence_summary };
}

// ── governance-report integration (export-artifact based) ───────────────────

function readArtifactFileContent(artifact, relPath) {
  const entry = artifact?.files?.[relPath];
  if (!entry) return null;
  if (typeof entry === 'string') return entry;
  if (typeof entry.data === 'string') return entry.data;
  if (typeof entry.content_base64 === 'string') {
    try {
      return Buffer.from(entry.content_base64, 'base64').toString('utf8');
    } catch {
      return null;
    }
  }
  return null;
}

function parseHistoryJsonl(content) {
  if (typeof content !== 'string' || !content.trim()) return [];
  return content
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// Affirmative ship-verdict tokens, mirroring workflow-gate-semantics
// (evaluateShipVerdict is not exported, so the artifact path checks the recorded
// gate outcome first and only falls back to a minimal verdict-line parse).
const AFFIRMATIVE_VERDICTS = new Set(['yes', 'ship', 'ship it']);

function evaluateShipVerdictFromArtifact(state, verdictContent, config) {
  const gateStatus = normalizeGateStatus(state?.phase_gate_status?.qa_ship_verdict);
  if (gateStatus === 'passed') {
    return dimension('qa_ship_verdict', 'pass', 'QA ship verdict gate passed.', null);
  }
  if (gateStatus === 'failed') {
    return dimension('qa_ship_verdict', 'fail', 'QA ship verdict gate failed.', 'QA did not approve shipping.');
  }

  if (typeof verdictContent === 'string' && verdictContent.trim()) {
    const match = verdictContent.match(/^##\s+Verdict\s*:\s*(.+)$/im);
    if (match) {
      const token = match[1].trim().toLowerCase().replace(/[.!]+$/, '');
      if (AFFIRMATIVE_VERDICTS.has(token)) {
        return dimension('qa_ship_verdict', 'pass', 'QA ship verdict is affirmative.', null);
      }
      return dimension(
        'qa_ship_verdict',
        'fail',
        `QA ship verdict is "${match[1].trim()}".`,
        `QA did not approve shipping: verdict "${match[1].trim()}".`,
      );
    }
  }

  const { reached, finalPhase } = finalPhaseReached(state, config);
  if (reached) {
    return dimension(
      'qa_ship_verdict',
      'fail',
      'QA ship verdict missing after QA phase.',
      `QA ship verdict missing after reaching the "${finalPhase}" phase.`,
    );
  }
  return dimension(
    'qa_ship_verdict',
    'pending',
    'QA ship verdict not yet produced.',
    `QA phase ("${finalPhase}") not yet reached; ship verdict pending.`,
  );
}

/**
 * Build the compact ship-status summary embedded in a governance report.
 * Operates on an export artifact (filesystem is not live), so release_alignment
 * is reported as pending — the live `agentxchain ship-status` command surfaces it.
 *
 * @param {object} artifact
 * @returns {{ overall, dimensions_passed, dimensions_total, blocking_reasons } | null}
 */
export function buildShipStatusSummary(artifact) {
  if (!artifact) return null;

  const state = artifact.state || null;
  const config = artifact.config || null;
  const history = parseHistoryJsonl(readArtifactFileContent(artifact, HISTORY_PATH));
  const verdictContent = readArtifactFileContent(artifact, SHIP_VERDICT_PATH);

  const dimensions = [
    evaluateRunCompletionDimension(state),
    evaluateShipVerdictFromArtifact(state, verdictContent, config),
    evaluateGateClearanceDimension(state, config),
    dimension(
      'release_alignment',
      'pending',
      'Release alignment is not evaluable from an export artifact.',
      'Release alignment not evaluated (run `agentxchain ship-status` for live evaluation).',
    ),
    evaluateTestVerificationDimension(history),
  ];

  const result = aggregateShipStatus(dimensions);
  return {
    overall: result.overall,
    dimensions_passed: result.dimensions.filter((d) => d.status === 'pass').length,
    dimensions_total: result.dimensions.length,
    blocking_reasons: result.blocking_reasons,
  };
}
