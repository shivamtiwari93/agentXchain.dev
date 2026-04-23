import { existsSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { loadProjectContext, loadProjectState } from '../lib/config.js';
import {
  evaluateArtifactSemantics,
  evaluateWorkflowGateSemantics,
  getSemanticIdForPath,
} from '../lib/workflow-gate-semantics.js';
import { getEffectiveGateArtifacts, hasRoleParticipationInPhase } from '../lib/gate-evaluator.js';

export function gateCommand(subcommand, gateId, opts) {
  const context = loadProjectContext();
  if (!context) {
    console.log(chalk.red('  No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { root, config, version } = context;
  if (version !== 4 || config.protocol_mode !== 'governed') {
    console.log(chalk.red('  Not a governed AgentXchain project (requires v4 config).'));
    process.exit(1);
  }

  const gateIds = Object.keys(config.gates || {});
  if (gateIds.length === 0) {
    console.log(chalk.red('  No gates defined in config.'));
    process.exit(1);
  }

  const state = loadProjectState(root, config);

  if (subcommand === 'show') {
    return showGate(gateId, { root, config, state, gateIds, opts });
  }

  return listGates({ root, config, state, gateIds, opts });
}

function findLinkedPhase(gateId, routing) {
  for (const [phaseId, route] of Object.entries(routing || {})) {
    if (route.exit_gate === gateId) return phaseId;
  }
  return null;
}

function buildGateRecord(root, config, state, gateId, evaluate) {
  const gateDef = config.gates[gateId] || {};
  const linkedPhase = findLinkedPhase(gateId, config.routing);
  const effectiveArtifacts = getEffectiveGateArtifacts(config, gateDef, linkedPhase);
  const requiresFiles = Array.isArray(gateDef.requires_files) ? gateDef.requires_files : [];
  const requiresVerification = gateDef.requires_verification_pass === true;
  const requiresHumanApproval = gateDef.requires_human_approval === true;
  const status = state?.phase_gate_status?.[gateId] || null;

  const lastFailure = state?.last_gate_failure?.gate_id === gateId
    ? state.last_gate_failure
    : null;

  const record = {
    id: gateId,
    linked_phase: linkedPhase,
    requires_files: requiresFiles,
    effective_artifacts: effectiveArtifacts.map(normalizeEffectiveArtifact),
    requires_verification_pass: requiresVerification,
    requires_human_approval: requiresHumanApproval,
    status,
    last_failure: lastFailure
      ? {
        gate_type: lastFailure.gate_type,
        phase: lastFailure.phase,
        failed_at: lastFailure.failed_at,
        reasons: lastFailure.reasons || [],
        missing_files: lastFailure.missing_files || [],
      }
      : null,
  };

  if (evaluate) {
    record.evaluation = evaluateGateSnapshot({
      root,
      state,
      linkedPhase,
      requiresVerification,
      effectiveArtifacts,
    });
  }

  return record;
}

function normalizeEffectiveArtifact(artifact) {
  return {
    path: artifact.path,
    required: artifact.required !== false,
    owned_by: artifact.owned_by || null,
    legacy_semantics: artifact.useLegacySemantics ? getSemanticIdForPath(artifact.path) : null,
    semantic_checks: Array.isArray(artifact.semanticChecks) ? artifact.semanticChecks : [],
  };
}

function getLatestAcceptedTurnForPhase(state, phase) {
  if (!phase || !Array.isArray(state?.history)) {
    return null;
  }

  for (let index = state.history.length - 1; index >= 0; index--) {
    const entry = state.history[index];
    if (entry?.phase === phase) {
      return entry;
    }
  }

  return null;
}

function buildOwnershipFailure(artifact, linkedPhase) {
  if (!artifact.owned_by) {
    return null;
  }

  if (!linkedPhase) {
    return `Gate is not linked to a routing phase, so ownership for "${artifact.path}" cannot be evaluated.`;
  }

  return `"${artifact.path}" requires participation from role "${artifact.owned_by}" in phase "${linkedPhase}", but no accepted turn from that role was found`;
}

function evaluateGateSnapshot({ root, state, linkedPhase, requiresVerification, effectiveArtifacts }) {
  const missingFiles = [];
  const semanticFailures = [];
  const ownershipFailures = [];

  const artifacts = effectiveArtifacts.map((artifact) => {
    const exists = existsSync(join(root, artifact.path));
    const failures = [];

    if (!exists && artifact.required) {
      const reason = `Required file missing: ${artifact.path}`;
      missingFiles.push(artifact.path);
      failures.push(reason);
    }

    if (exists && artifact.useLegacySemantics) {
      const semanticCheck = evaluateWorkflowGateSemantics(root, artifact.path);
      if (semanticCheck && !semanticCheck.ok) {
        semanticFailures.push(semanticCheck.reason);
        failures.push(semanticCheck.reason);
      }
    }

    if (exists) {
      for (const semantic of artifact.semanticChecks || []) {
        const semanticCheck = evaluateArtifactSemantics(root, {
          path: artifact.path,
          semantics: semantic.semantics,
          semantics_config: semantic.semantics_config,
        });
        if (semanticCheck && !semanticCheck.ok) {
          semanticFailures.push(semanticCheck.reason);
          failures.push(semanticCheck.reason);
        }
      }
    }

    const ownershipSatisfied = artifact.owned_by && linkedPhase
      ? hasRoleParticipationInPhase(state, linkedPhase, artifact.owned_by)
      : null;
    if (artifact.owned_by && linkedPhase && ownershipSatisfied === false) {
      const reason = buildOwnershipFailure(artifact, linkedPhase);
      ownershipFailures.push(reason);
      failures.push(reason);
    }

    return {
      ...normalizeEffectiveArtifact(artifact),
      exists,
      ownership_satisfied: ownershipSatisfied,
      failures,
    };
  });

  const latestAcceptedTurn = getLatestAcceptedTurnForPhase(state, linkedPhase);
  const verificationStatus = latestAcceptedTurn?.verification?.status || null;
  const verificationPassed = verificationStatus === 'pass' || verificationStatus === 'attested_pass';
  const reasons = [
    ...artifacts.flatMap((artifact) => artifact.failures),
  ];

  if (requiresVerification && !verificationPassed) {
    reasons.push(`Verification status is "${verificationStatus || 'missing'}", requires "pass" or "attested_pass"`);
  }

  return {
    phase: linkedPhase,
    passed: reasons.length === 0,
    reasons,
    missing_files: missingFiles,
    semantic_failures: semanticFailures,
    ownership_failures: ownershipFailures,
    artifacts,
    verification: {
      required: requiresVerification,
      source_turn_id: latestAcceptedTurn?.turn_id || null,
      status: verificationStatus,
      passed: requiresVerification ? verificationPassed : null,
    },
  };
}

function listGates({ root, config, state, gateIds, opts }) {
  const gates = gateIds.map((id) => buildGateRecord(root, config, state, id, false));

  if (opts.json) {
    console.log(JSON.stringify({ gates }, null, 2));
    return;
  }

  console.log(chalk.bold(`\n  Gates (${gates.length}):\n`));
  for (const gate of gates) {
    const phase = gate.linked_phase || chalk.dim('orphaned');
    const approval = gate.requires_human_approval ? chalk.yellow('human-approval') : 'auto';
    const predicates = [];
    if (gate.effective_artifacts.length > 0) predicates.push(`${gate.effective_artifacts.length} artifact${gate.effective_artifacts.length > 1 ? 's' : ''}`);
    if (gate.requires_verification_pass) predicates.push('verification');
    const predicateStr = predicates.length > 0 ? predicates.join(' + ') : 'none';
    const statusStr = gate.status ? ` [${gate.status}]` : '';
    console.log(`  ${chalk.cyan(gate.id)}${statusStr} — phase ${chalk.bold(phase)}, ${approval}, requires ${predicateStr}`);
  }
  console.log('');
  console.log(chalk.dim('  Usage: agentxchain gate show <gate_id>\n'));
}

function showGate(requestedGateId, { root, config, state, gateIds, opts }) {
  if (!requestedGateId) {
    console.log(chalk.red('  Gate ID is required.'));
    console.log(chalk.dim(`  Available: ${gateIds.join(', ')}`));
    process.exit(1);
  }

  if (!config.gates[requestedGateId]) {
    console.log(chalk.red(`  Unknown gate: ${requestedGateId}`));
    console.log(chalk.dim(`  Available: ${gateIds.join(', ')}`));
    process.exit(1);
  }

  const gate = buildGateRecord(root, config, state, requestedGateId, opts.evaluate);

  if (opts.json) {
    console.log(JSON.stringify(gate, null, 2));
    return;
  }

  console.log(chalk.bold(`\n  Gate: ${chalk.cyan(gate.id)}\n`));
  console.log(`  Linked phase:       ${gate.linked_phase || chalk.dim('none (orphaned)')}`);
  console.log(`  Human approval:     ${gate.requires_human_approval ? chalk.yellow('yes') : 'no'}`);
  console.log(`  Verification:       ${gate.requires_verification_pass ? 'required' : 'not required'}`);
  if (gate.status) {
    const statusColor = gate.status === 'passed' ? chalk.green : gate.status === 'failed' ? chalk.red : chalk.yellow;
    console.log(`  Status:             ${statusColor(gate.status)}`);
  }
  if (gate.evaluation) {
    console.log(`  Evaluation:         ${gate.evaluation.passed ? chalk.green('pass') : chalk.red('fail')}`);
  }
  console.log('');

  if (gate.effective_artifacts.length === 0) {
    console.log(`  ${chalk.dim('Effective artifacts:')} none\n`);
  } else {
    console.log(`  ${chalk.dim('Effective artifacts:')}`);
    const evaluatedArtifacts = gate.evaluation?.artifacts || [];
    for (const artifact of gate.effective_artifacts) {
      const artifactEval = evaluatedArtifacts.find((entry) => entry.path === artifact.path);
      const icon = artifactEval
        ? artifactEval.failures.length === 0
          ? chalk.green('\u2713')
          : chalk.red('\u2717')
        : chalk.dim('-');
      const owner = artifact.owned_by || 'none';
      const semantics = [
        artifact.legacy_semantics,
        ...artifact.semantic_checks.map((entry) => entry.semantics),
      ].filter(Boolean);
      console.log(`    ${icon} ${artifact.path} [${artifact.required ? 'required' : 'optional'}] [owner: ${owner}] [semantics: ${semantics.length > 0 ? semantics.join(', ') : 'none'}]`);
      if (artifactEval?.failures.length) {
        for (const failure of artifactEval.failures) {
          console.log(`      ${chalk.dim(`- ${failure}`)}`);
        }
      }
    }
    console.log('');
  }

  if (gate.evaluation && gate.requires_verification_pass) {
    const vpIcon = gate.evaluation.verification.passed ? chalk.green('\u2713') : chalk.red('\u2717');
    const source = gate.evaluation.verification.source_turn_id
      ? ` (${gate.evaluation.verification.source_turn_id})`
      : '';
    console.log(`  Verification pass: ${vpIcon} ${gate.evaluation.verification.passed ? 'yes' : 'no'}${source}\n`);
  }

  if (gate.last_failure) {
    console.log(chalk.dim('  Last failure:'));
    console.log(`    Type:    ${gate.last_failure.gate_type}`);
    console.log(`    Phase:   ${gate.last_failure.phase}`);
    console.log(`    At:      ${gate.last_failure.failed_at}`);
    if (gate.last_failure.reasons.length > 0) {
      console.log(`    Reasons: ${gate.last_failure.reasons.join('; ')}`);
    }
    if (gate.last_failure.missing_files.length > 0) {
      console.log(`    Missing: ${gate.last_failure.missing_files.join(', ')}`);
    }
    console.log('');
  }

  const standingHint = getStandingRecoveryHint(gate, state);
  if (standingHint) {
    console.log(chalk.dim('  Recovery:'));
    console.log(chalk.dim(`    No phase transition is prepared for "${standingHint.gateId}".`));
    console.log(chalk.dim('    If a human escalation is open, resolve with: agentxchain unblock <hesc_id>'));
    console.log(chalk.dim('    After resolution, run: agentxchain approve-transition'));
    console.log('');
  }
}

function getStandingRecoveryHint(gate, state) {
  if (!gate) return null;
  if (!gate.requires_human_approval) return null;
  if (gate.status !== 'pending') return null;
  const currentPhase = state?.phase || null;
  if (!currentPhase || gate.linked_phase !== currentPhase) return null;
  if (state?.pending_phase_transition) return null;
  return { gateId: gate.id };
}
