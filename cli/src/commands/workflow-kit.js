import chalk from 'chalk';
import { existsSync } from 'fs';
import { join } from 'path';
import { loadProjectContext, loadProjectState } from '../lib/config.js';
import {
  VALID_WORKFLOW_KIT_PHASE_TEMPLATE_IDS,
  listWorkflowKitPhaseTemplates,
} from '../lib/workflow-kit-phase-templates.js';
import { getEffectiveGateArtifacts } from '../lib/gate-evaluator.js';

const WORKFLOW_KIT_VERSION = '1.0';

const SEMANTIC_VALIDATOR_IDS = [
  'pm_signoff',
  'system_spec',
  'implementation_notes',
  'acceptance_matrix',
  'ship_verdict',
  'release_notes',
  'section_check',
];

const DEFAULT_TEMPLATE_BY_PHASE = {
  planning: 'planning-default',
  implementation: 'implementation-default',
  qa: 'qa-default',
};

export { WORKFLOW_KIT_VERSION, SEMANTIC_VALIDATOR_IDS };

function buildWorkflowKitContract(root, config, state) {
  const phaseIds = Object.keys(config.routing || {});
  const hasExplicitKit = config.workflow_kit?._explicit === true;

  const templatesInUse = new Set();
  const phases = {};

  for (const phaseId of phaseIds) {
    const phaseKit = config.workflow_kit?.phases?.[phaseId] || null;
    // For default (non-explicit) workflow kits, infer template from phase name
    const template = phaseKit?.template || (!hasExplicitKit ? (DEFAULT_TEMPLATE_BY_PHASE[phaseId] || null) : null);
    if (template) templatesInUse.add(template);

    const source = !hasExplicitKit
      ? 'default'
      : phaseKit
        ? 'explicit'
        : 'not_declared';

    const artifacts = (phaseKit?.artifacts || [])
      .filter((a) => a && typeof a.path === 'string')
      .map((artifact) => ({
        path: artifact.path,
        required: artifact.required !== false,
        semantics: artifact.semantics || null,
        exists: existsSync(join(root, artifact.path)),
      }));

    phases[phaseId] = { template: template || null, source, artifacts };
  }

  const overallSource = !hasExplicitKit
    ? 'default'
    : phaseIds.every((id) => phases[id].source === 'explicit')
      ? 'explicit'
      : 'mixed';

  const gateArtifactCoverage = {};
  const gates = config.gates || {};
  for (const [gateId, gateDef] of Object.entries(gates)) {
    const linkedPhase = gateDef.phase || null;
    const effectiveArtifacts = linkedPhase
      ? getEffectiveGateArtifacts(config, gateDef, linkedPhase)
      : [];
    gateArtifactCoverage[gateId] = {
      predicates_referencing_artifacts: effectiveArtifacts.length,
      artifacts_covered: effectiveArtifacts.map((a) => a.path),
    };
  }

  return {
    workflow_kit_version: WORKFLOW_KIT_VERSION,
    source: overallSource,
    phase_templates: {
      available: [...VALID_WORKFLOW_KIT_PHASE_TEMPLATE_IDS],
      in_use: [...templatesInUse],
    },
    phases,
    semantic_validators: [...SEMANTIC_VALIDATOR_IDS],
    gate_artifact_coverage: gateArtifactCoverage,
  };
}

export { buildWorkflowKitContract };

export function workflowKitDescribeCommand(opts) {
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

  const phaseIds = Object.keys(config.routing || {});
  if (phaseIds.length === 0) {
    console.log(chalk.red('  No governed phases are defined in routing.'));
    process.exit(1);
  }

  const state = loadProjectState(root, config);
  const contract = buildWorkflowKitContract(root, config, state);

  if (opts.json) {
    console.log(JSON.stringify(contract, null, 2));
    return;
  }

  console.log(chalk.bold(`\n  Workflow Kit v${contract.workflow_kit_version}\n`));
  console.log(`  Source:     ${contract.source}`);
  console.log(`  Templates:  ${contract.phase_templates.available.length} available, ${contract.phase_templates.in_use.length} in use`);
  if (contract.phase_templates.in_use.length > 0) {
    console.log(`              ${chalk.dim(contract.phase_templates.in_use.join(', '))}`);
  }
  console.log(`  Validators: ${contract.semantic_validators.join(', ')}`);
  console.log('');

  for (const [phaseId, phase] of Object.entries(contract.phases)) {
    const templateLabel = phase.template ? ` (${phase.template})` : '';
    console.log(chalk.bold(`  Phase: ${chalk.cyan(phaseId)}`) + chalk.dim(templateLabel));
    console.log(`  Source: ${phase.source}`);

    if (phase.artifacts.length === 0) {
      console.log(`  ${chalk.dim('No artifacts declared')}`);
    } else {
      for (const artifact of phase.artifacts) {
        const icon = artifact.exists
          ? chalk.green('✓')
          : artifact.required
            ? chalk.red('✗')
            : chalk.yellow('○');
        const sem = artifact.semantics ? chalk.dim(` [${artifact.semantics}]`) : '';
        const req = artifact.required ? '' : chalk.dim(' (optional)');
        console.log(`    ${icon} ${artifact.path}${sem}${req}`);
      }
    }
    console.log('');
  }

  const gateEntries = Object.entries(contract.gate_artifact_coverage);
  if (gateEntries.length > 0) {
    console.log(chalk.bold('  Gate artifact coverage:'));
    for (const [gateId, cov] of gateEntries) {
      console.log(`    ${gateId}: ${cov.predicates_referencing_artifacts} artifact(s) — ${cov.artifacts_covered.join(', ') || chalk.dim('none')}`);
    }
    console.log('');
  }
}
