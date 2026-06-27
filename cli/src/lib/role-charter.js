/**
 * Role Charter Well-Formedness — VISION.md:100–130 "Roles Are Open-Ended, Not Fixed".
 *
 * The vision fixes a precise, testable four-part invariant for *any* chartered
 * role (VISION.md:123–128):
 *
 *   1. every role has a mandate
 *   2. every role has authority boundaries
 *   3. every role produces governed artifacts
 *   4. every role participates in a structured workflow
 *
 * This module scores a role definition against those four invariants. It is
 * **read-only** and **composes** existing primitives — it does not reimplement
 * runtime-capability derivation (`runtime-capabilities.js`), gate-artifact
 * resolution (`gate-evaluator.js`), or the manual-runtime / file-production
 * logic that admission control (`admission-control.js`) already relies on.
 *
 * `agentxchain role` permits arbitrary roles; this module *governs* them.
 */

import { getEffectiveGateArtifacts } from './gate-evaluator.js';
import {
  getRoleRuntimeCapabilityContract,
  canRoleParticipateInRequiredFileProduction,
  canRoleSatisfyWorkflowArtifactOwnership,
} from './runtime-capabilities.js';

const VALID_WRITE_AUTHORITIES = ['authoritative', 'proposed', 'review_only'];

// effective_write_path values that mean the authority binding is NOT coherent
// with the runtime — i.e. the role can never actually exercise its declared
// authority (e.g. review_only on a local_cli runtime that only writes directly).
const INCOHERENT_WRITE_PATHS = new Set([
  'none',
  'unknown',
  'invalid_review_only_binding',
  'invalid_authoritative_binding',
]);

export const ROLE_CHARTER_INVARIANT_IDS = [
  'mandate',
  'authority_boundary',
  'produces_artifacts',
  'workflow_participation',
];

/**
 * Resolve the config surfaces this module needs, tolerating either a normalized
 * config (roles carry `runtime_id`) or a raw agentxchain.json (roles carry
 * `runtime`). Mirrors admission-control.js's `config || rawConfig` fallback so
 * the same evaluator works from the CLI (normalized) and the governance report
 * (raw export artifact config).
 */
function resolveConfigSources(config, rawConfig) {
  return {
    roles: config?.roles || rawConfig?.roles || {},
    runtimes: config?.runtimes || rawConfig?.runtimes || {},
    routing: config?.routing || rawConfig?.routing || {},
    gates: config?.gates || rawConfig?.gates || {},
    // getEffectiveGateArtifacts only reads `config.workflow_kit`, so hand it a
    // shim carrying whichever workflow_kit is available.
    workflowKitConfig: { workflow_kit: config?.workflow_kit || rawConfig?.workflow_kit || null },
  };
}

function getRoleRuntime(role, runtimes) {
  const key = role?.runtime_id || role?.runtime;
  return key ? runtimes?.[key] : undefined;
}

/** Phases whose routing references this role as entry_role or allowed_next_roles. */
function getRoutedPhases(routing, roleId) {
  const phases = [];
  for (const [phase, route] of Object.entries(routing || {})) {
    const inEntry = route?.entry_role === roleId;
    const inNext = Array.isArray(route?.allowed_next_roles) && route.allowed_next_roles.includes(roleId);
    if (inEntry || inNext) phases.push(phase);
  }
  return phases;
}

// ── Invariant 1: Mandate (VISION.md:124) ────────────────────────────────────

function evaluateMandate(role, roleId) {
  const mandate = typeof role?.mandate === 'string' ? role.mandate.trim() : '';
  const satisfied = mandate.length > 0;
  return {
    id: 'mandate',
    name: 'Has a mandate',
    satisfied,
    detail: satisfied
      ? `Role "${roleId}" declares a non-empty mandate.`
      : `Role "${roleId}" has no mandate text.`,
    fix_hint: satisfied
      ? null
      : `Set a non-empty "mandate" for role "${roleId}" in agentxchain.json`,
  };
}

// ── Invariant 2: Authority boundary (VISION.md:125) ─────────────────────────

function evaluateAuthorityBoundary(role, roleId, runtimes) {
  const authority = role?.write_authority;
  const runtimeKey = role?.runtime_id || role?.runtime || null;
  const runtime = getRoleRuntime(role, runtimes);

  if (!VALID_WRITE_AUTHORITIES.includes(authority)) {
    return {
      id: 'authority_boundary',
      name: 'Has coherent authority boundaries',
      satisfied: false,
      detail: `Role "${roleId}" write_authority "${authority ?? '(unset)'}" is not one of ${VALID_WRITE_AUTHORITIES.join('/')}.`,
      fix_hint: `Set role "${roleId}" write_authority to one of ${VALID_WRITE_AUTHORITIES.join('/')}`,
    };
  }

  if (!runtime) {
    return {
      id: 'authority_boundary',
      name: 'Has coherent authority boundaries',
      satisfied: false,
      detail: `Role "${roleId}" is bound to runtime "${runtimeKey ?? '(none)'}" which is not defined in runtimes.`,
      fix_hint: `Bind role "${roleId}" to a defined runtime so its authority "${authority}" can resolve`,
    };
  }

  const contract = getRoleRuntimeCapabilityContract(roleId, role, runtime);
  const coherent = !INCOHERENT_WRITE_PATHS.has(contract.effective_write_path);

  return {
    id: 'authority_boundary',
    name: 'Has coherent authority boundaries',
    satisfied: coherent,
    detail: coherent
      ? `Role "${roleId}" write_authority "${authority}" on ${runtime.type} runtime resolves to write path "${contract.effective_write_path}".`
      : `Role "${roleId}" write_authority "${authority}" on ${runtime.type} runtime resolves to "${contract.effective_write_path}".`,
    fix_hint: coherent
      ? null
      : `Role "${roleId}" write_authority "${authority}" on ${runtime.type} runtime resolves to no usable write path; bind a runtime that supports it or change authority`,
  };
}

// ── Invariant 3: Produces governed artifacts (VISION.md:126) ────────────────

function evaluateProducesArtifacts(role, roleId, sources) {
  const { runtimes, routing, gates, workflowKitConfig } = sources;
  const runtime = getRoleRuntime(role, runtimes);
  const routedPhases = getRoutedPhases(routing, roleId);

  // (a) The role can reach required-file production in at least one routed
  // phase. canRoleParticipateInRequiredFileProduction already returns true for
  // manual-runtime roles (humans satisfy required files outside the governed
  // turn mechanism) — that is the manual-runtime carve-out admission control
  // also relies on, so no special-casing is needed here.
  let reachesFileProduction = false;
  if (canRoleParticipateInRequiredFileProduction(role, runtime)) {
    for (const phase of routedPhases) {
      const gateId = routing[phase]?.exit_gate;
      const gateDef = gateId ? gates?.[gateId] : null;
      if (!gateDef) continue;
      const artifacts = getEffectiveGateArtifacts(workflowKitConfig, gateDef, phase);
      if (artifacts.some((a) => a.required)) {
        reachesFileProduction = true;
        break;
      }
    }
  }

  // (b) The role owns at least one workflow-kit artifact it can satisfy.
  let ownsSatisfiableArtifact = false;
  if (canRoleSatisfyWorkflowArtifactOwnership(role, runtime)) {
    for (const phase of Object.keys(routing || {})) {
      const gateId = routing[phase]?.exit_gate;
      const gateDef = (gateId ? gates?.[gateId] : null) || {};
      const artifacts = getEffectiveGateArtifacts(workflowKitConfig, gateDef, phase);
      if (artifacts.some((a) => a.owned_by === roleId)) {
        ownsSatisfiableArtifact = true;
        break;
      }
    }
  }

  const satisfied = reachesFileProduction || ownsSatisfiableArtifact;
  let detail;
  if (reachesFileProduction && ownsSatisfiableArtifact) {
    detail = `Role "${roleId}" reaches required-file production in a routed phase and owns a governed artifact.`;
  } else if (reachesFileProduction) {
    detail = `Role "${roleId}" reaches required-file production in a routed phase.`;
  } else if (ownsSatisfiableArtifact) {
    detail = `Role "${roleId}" owns a governed workflow-kit artifact it can satisfy.`;
  } else {
    detail = `Role "${roleId}" reaches no required-file-producing routed phase and owns no satisfiable artifact.`;
  }

  return {
    id: 'produces_artifacts',
    name: 'Produces governed artifacts',
    satisfied,
    detail,
    fix_hint: satisfied
      ? null
      : `Role "${roleId}" produces no governed artifact: route it to a file-producing phase or give it owned_by on a workflow artifact`,
  };
}

// ── Invariant 4: Participates in a structured workflow (VISION.md:127) ───────

function evaluateWorkflowParticipation(roleId, routing) {
  const phases = getRoutedPhases(routing, roleId);
  const satisfied = phases.length > 0;
  return {
    id: 'workflow_participation',
    name: 'Participates in a structured workflow',
    satisfied,
    detail: satisfied
      ? `Role "${roleId}" appears in routing for phase(s): ${phases.join(', ')}.`
      : `Role "${roleId}" is not referenced in any phase routing.`,
    fix_hint: satisfied
      ? null
      : `Role "${roleId}" is not in any phase routing; add it to entry_role or allowed_next_roles of a phase`,
  };
}

/**
 * Score a single role against the four VISION:123–128 charter invariants.
 * Read-only. Each invariant is evaluated independently — one failing invariant
 * never suppresses evaluation of the others.
 *
 * @returns {{ role_id, overall, invariants, missing, evidence_summary }}
 */
export function evaluateRoleCharter(config, rawConfig, roleId) {
  const sources = resolveConfigSources(config, rawConfig);
  const role = sources.roles?.[roleId] || null;

  const invariants = [
    evaluateMandate(role, roleId),
    evaluateAuthorityBoundary(role, roleId, sources.runtimes),
    evaluateProducesArtifacts(role, roleId, sources),
    evaluateWorkflowParticipation(roleId, sources.routing),
  ];

  const missing = invariants.filter((inv) => !inv.satisfied).map((inv) => inv.id);
  const overall = missing.length === 0 ? 'well_formed' : 'incomplete';

  return {
    role_id: roleId,
    overall,
    invariants,
    missing,
    evidence_summary:
      overall === 'well_formed'
        ? `Role "${roleId}" is well-formed (4/4 charter invariants satisfied).`
        : `Role "${roleId}" is incomplete — missing: ${missing.join(', ')}.`,
  };
}

/**
 * Score every defined role against the four charter invariants. Roles are
 * reported in stable order (sorted by id) so output and tests are deterministic.
 *
 * @returns {{ total, well_formed, incomplete, incomplete_role_ids, roles }}
 */
export function evaluateAllRoleCharters(config, rawConfig) {
  const sources = resolveConfigSources(config, rawConfig);
  const roleIds = Object.keys(sources.roles || {}).sort();
  const roles = roleIds.map((id) => evaluateRoleCharter(config, rawConfig, id));
  const incomplete = roles.filter((r) => r.overall === 'incomplete');

  return {
    total: roles.length,
    well_formed: roles.length - incomplete.length,
    incomplete: incomplete.length,
    incomplete_role_ids: incomplete.map((r) => r.role_id),
    roles,
  };
}

/**
 * Compact summary for the governance report (`report.role_charters`), mirroring
 * buildHumanAttentionSummary / buildShipStatusSummary. The export artifact's
 * `config` is the raw agentxchain.json, which evaluateAllRoleCharters tolerates.
 */
export function buildRoleCharterSummary(artifact) {
  if (!artifact) return null;
  const config = artifact.config || null;
  if (!config) return null;
  const report = evaluateAllRoleCharters(config, config);
  return {
    total: report.total,
    well_formed: report.well_formed,
    incomplete: report.incomplete,
    incomplete_role_ids: report.incomplete_role_ids,
  };
}
