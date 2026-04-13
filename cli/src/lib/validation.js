import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { validateStagedTurnResult, STAGING_PATH } from './turn-result-validator.js';
import { getActiveTurn } from './governed-state.js';
import {
  validateGovernedProjectTemplate,
  validateGovernedTemplateRegistry,
  validateProjectPlanningArtifacts,
  validateAcceptanceHintCompletion,
  validateGovernedWorkflowKit,
} from './governed-templates.js';
import { collectRemoteReviewOnlyGateWarnings } from './normalized-config.js';

const DEFAULT_REQUIRED_FILES = [
  '.planning/PROJECT.md',
  '.planning/REQUIREMENTS.md',
  '.planning/ROADMAP.md',
  '.planning/PM_SIGNOFF.md',
  '.planning/qa/TEST-COVERAGE.md',
  '.planning/qa/BUGS.md',
  '.planning/qa/UX-AUDIT.md',
  '.planning/qa/ACCEPTANCE-MATRIX.md',
  '.planning/qa/REGRESSION-LOG.md',
];

const PROTOCOL_FILES = [
  'lock.json',
  'state.json'
];

export function validateProject(root, config, opts = {}) {
  const mode = opts.mode || 'full';
  const expectedAgent = opts.expectedAgent || null;
  const talkFile = config.talk_file || 'TALK.md';

  const errors = [];
  const warnings = [];

  const customRequired = config.rules?.required_files;
  const planningFiles = Array.isArray(customRequired) ? customRequired : DEFAULT_REQUIRED_FILES;

  const dynamicFiles = [
    talkFile,
    config.state_file || 'state.md',
    config.history_file || 'history.jsonl',
  ];

  const mustExist = [...planningFiles, ...dynamicFiles, ...PROTOCOL_FILES];

  for (const rel of mustExist) {
    if (!existsSync(join(root, rel))) {
      errors.push(`Missing required file: ${rel}`);
    }
  }

  const signoff = readText(root, '.planning/PM_SIGNOFF.md');
  const signoffApproved = /approved\s*:\s*yes/i.test(signoff || '');
  if (!signoffApproved) {
    if (mode === 'kickoff' || mode === 'full') {
      errors.push('PM signoff is not approved. Set "Approved: YES" in .planning/PM_SIGNOFF.md.');
    } else {
      warnings.push('PM signoff is not approved.');
    }
  }

  const roadmap = readText(root, '.planning/ROADMAP.md') || '';
  if (!/\bwave\b/i.test(roadmap)) {
    errors.push('ROADMAP.md must define at least one Wave.');
  }
  if (!/\bphase\b/i.test(roadmap)) {
    errors.push('ROADMAP.md must define at least one Phase.');
  }

  const phaseStatus = validatePhaseArtifacts(root);
  errors.push(...phaseStatus.errors);
  warnings.push(...phaseStatus.warnings);

  const history = validateHistory(root, config, { expectedAgent, requireEntry: mode !== 'kickoff' });
  errors.push(...history.errors);
  warnings.push(...history.warnings);

  const talk = validateTalkFile(root, talkFile, { requireEntry: mode !== 'kickoff' });
  errors.push(...talk.errors);
  warnings.push(...talk.warnings);

  const qaSignals = validateQaArtifacts(root);
  warnings.push(...qaSignals.warnings);

  return { ok: errors.length === 0, mode, errors, warnings };
}

export function validateGovernedProject(root, rawConfig, config, opts = {}) {
  const mode = opts.mode || 'full';
  const expectedRole = opts.expectedAgent || null;
  const errors = [];
  const warnings = [];

  const templateRegistry = validateGovernedTemplateRegistry();
  errors.push(...templateRegistry.errors);
  warnings.push(...templateRegistry.warnings);

  const projectTemplate = validateGovernedProjectTemplate(rawConfig?.template);
  errors.push(...projectTemplate.errors);
  warnings.push(...projectTemplate.warnings);

  // Validate planning artifact completeness against the configured template
  const planningArtifacts = validateProjectPlanningArtifacts(root, rawConfig?.template);
  errors.push(...planningArtifacts.errors);
  warnings.push(...planningArtifacts.warnings);

  // Validate acceptance hint completion against the configured template
  const acceptanceHints = validateAcceptanceHintCompletion(root, rawConfig?.template);
  warnings.push(...acceptanceHints.warnings);

  const workflowKit = validateGovernedWorkflowKit(root, config);
  errors.push(...workflowKit.errors);
  warnings.push(...workflowKit.warnings);

  // Config-shape warnings (dead-end gates, etc.) — mirrors doctor/config --set surfaces
  warnings.push(...collectRemoteReviewOnlyGateWarnings(rawConfig));

  const mustExist = [
    config.files?.state || '.agentxchain/state.json',
    config.files?.history || '.agentxchain/history.jsonl',
  ];

  for (const rel of mustExist) {
    if (!existsSync(join(root, rel))) {
      errors.push(`Missing required file: ${rel}`);
    }
  }

  const prompts = rawConfig?.prompts && typeof rawConfig.prompts === 'object' ? rawConfig.prompts : {};
  for (const [roleId, rel] of Object.entries(prompts)) {
    if (typeof rel !== 'string' || !rel.trim()) {
      errors.push(`Prompt path for role "${roleId}" must be a non-empty string.`);
      continue;
    }
    if (!existsSync(join(root, rel))) {
      errors.push(`Missing prompt file for role "${roleId}": ${rel}`);
    }
  }

  const statePath = join(root, config.files?.state || '.agentxchain/state.json');
  const state = readJson(statePath);
  if (!state) {
    errors.push(`Unable to parse ${config.files?.state || '.agentxchain/state.json'}.`);
  } else {
    if (state.phase && config.routing && !config.routing[state.phase]) {
      errors.push(`State phase "${state.phase}" is not defined in routing.`);
    }

    if (state.phase_gate_status && typeof state.phase_gate_status === 'object') {
      for (const gateId of Object.keys(state.phase_gate_status)) {
        if (!config.gates?.[gateId]) {
          errors.push(`state.phase_gate_status references unknown gate "${gateId}".`);
        }
      }
    }

    if (mode === 'turn') {
      const activeTurn = getActiveTurn(state) || state.current_turn;
      if (!activeTurn) {
        errors.push('Governed turn validation requires an active turn.');
      } else if (expectedRole && activeTurn.assigned_role !== expectedRole) {
        errors.push(`Current turn role "${activeTurn.assigned_role}" does not match expected "${expectedRole}".`);
      }
    }

    if (!getActiveTurn(state) && !state.current_turn) {
      warnings.push('No active turn present in governed state. The run may be idle or paused.');
    }
  }

  const historyPath = join(root, config.files?.history || '.agentxchain/history.jsonl');
  const historyLines = readJsonLines(historyPath);
  if (historyLines.error) {
    errors.push(historyLines.error);
  } else if (historyLines.lines.length === 0) {
    warnings.push(`${config.files?.history || '.agentxchain/history.jsonl'} has no accepted turn entries yet.`);
  } else {
    const last = historyLines.lines[historyLines.lines.length - 1];
    if (last && typeof last === 'object') {
      if (!last.turn_id) warnings.push('Last governed history entry has no turn_id.');
      if (!last.role) warnings.push('Last governed history entry has no role.');
      if (!last.status) warnings.push('Last governed history entry has no status.');
    }
  }

  // ── Staged turn-result validation (the acceptance boundary) ─────────────
  if (mode === 'turn' && state) {
    const stagingAbs = join(root, STAGING_PATH);
    if (!existsSync(stagingAbs)) {
      warnings.push(`No staged turn result found at ${STAGING_PATH}. Agent has not yet emitted a turn result.`);
    } else {
      const turnValidation = validateStagedTurnResult(root, state, config);
      if (!turnValidation.ok) {
        errors.push(
          `Staged turn result failed at stage "${turnValidation.stage}" (${turnValidation.error_class}):`,
          ...turnValidation.errors.map(e => `  • ${e}`)
        );
      }
      warnings.push(...(turnValidation.warnings || []));
    }
  }

  return { ok: errors.length === 0, mode, errors, warnings };
}

function validatePhaseArtifacts(root) {
  const result = { errors: [], warnings: [] };
  const phasesDir = join(root, '.planning', 'phases');
  if (!existsSync(phasesDir)) {
    result.errors.push('Missing .planning/phases directory.');
    return result;
  }

  const entries = safeReadDir(phasesDir).filter(name => !name.startsWith('.'));
  if (entries.length === 0) {
    result.errors.push('No phase artifacts found. Add .planning/phases/phase-*/PLAN.md and TESTS.md.');
    return result;
  }

  let hasAnyPlan = false;
  let hasAnyTests = false;
  for (const name of entries) {
    const plan = join(phasesDir, name, 'PLAN.md');
    const tests = join(phasesDir, name, 'TESTS.md');
    if (existsSync(plan)) hasAnyPlan = true;
    if (existsSync(tests)) hasAnyTests = true;
  }

  if (!hasAnyPlan) result.errors.push('No phase PLAN.md found under .planning/phases/.');
  if (!hasAnyTests) result.errors.push('No phase TESTS.md found under .planning/phases/.');
  return result;
}

function validateHistory(root, config, opts) {
  const result = { errors: [], warnings: [] };
  const historyPath = join(root, config.history_file || 'history.jsonl');
  if (!existsSync(historyPath)) {
    result.errors.push(`${config.history_file || 'history.jsonl'} is missing.`);
    return result;
  }

  const lines = (readFileSync(historyPath, 'utf8') || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    if (opts.requireEntry) {
      result.errors.push(`${config.history_file || 'history.jsonl'} has no entries.`);
    } else {
      result.warnings.push(`${config.history_file || 'history.jsonl'} has no entries yet.`);
    }
    return result;
  }

  const lastRaw = lines[lines.length - 1];
  let last;
  try {
    last = JSON.parse(lastRaw);
  } catch {
    result.errors.push(`Last ${config.history_file || 'history.jsonl'} entry is not valid JSON.`);
    return result;
  }

  const requiredFields = ['turn', 'agent', 'summary', 'files_changed', 'verify_result', 'timestamp'];
  for (const f of requiredFields) {
    if (!(f in last)) result.errors.push(`Last history entry missing field: ${f}`);
  }

  if (last.agent && !config.agents?.[last.agent]) {
    result.errors.push(`Last history agent "${last.agent}" is not in agentxchain.json.`);
  }
  if (!Array.isArray(last.files_changed)) {
    result.errors.push('Last history entry: files_changed must be an array.');
  }
  if (last.verify_result && !['pass', 'fail', 'skipped'].includes(last.verify_result)) {
    result.errors.push('Last history entry: verify_result must be pass|fail|skipped.');
  }
  if (opts.expectedAgent && last.agent !== opts.expectedAgent) {
    result.errors.push(`Last history entry agent "${last.agent}" does not match expected "${opts.expectedAgent}".`);
  }

  return result;
}

function validateQaArtifacts(root) {
  const result = { warnings: [] };
  const checks = [
    ['.planning/qa/TEST-COVERAGE.md', /\(QA fills this as testing progresses\)/i, 'TEST-COVERAGE.md still looks uninitialized'],
    ['.planning/qa/ACCEPTANCE-MATRIX.md', /\(QA fills this from REQUIREMENTS\.md\)/i, 'ACCEPTANCE-MATRIX.md still looks uninitialized'],
    ['.planning/qa/UX-AUDIT.md', /\(QA adds UX issues here\)/i, 'UX-AUDIT.md issues table appears unmodified']
  ];

  for (const [rel, placeholderRegex, message] of checks) {
    const text = readText(root, rel);
    if (text && placeholderRegex.test(text)) {
      result.warnings.push(message);
    }
  }

  return result;
}

function validateTalkFile(root, talkFile, opts) {
  const result = { errors: [], warnings: [] };
  const text = readText(root, talkFile);
  if (!text) {
    result.errors.push(`${talkFile} is missing or unreadable.`);
    return result;
  }

  const hasTurnEntry = /##\s*Turn\s+\d+/i.test(text);
  if (!hasTurnEntry) {
    if (opts.requireEntry) {
      result.errors.push(`${talkFile} has no turn entries.`);
    } else {
      result.warnings.push(`${talkFile} has no turn entries yet.`);
    }
  }

  return result;
}

function readText(root, rel) {
  const path = join(root, rel);
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function safeReadDir(path) {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function readJsonLines(path) {
  if (!existsSync(path)) {
    return { lines: [], error: `${path.split('/').pop()} is missing.` };
  }

  try {
    const raw = readFileSync(path, 'utf8');
    const lines = raw
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        try {
          return JSON.parse(line);
        } catch {
          throw new Error(`Invalid JSONL entry at line ${index + 1}.`);
        }
      });
    return { lines, error: null };
  } catch (err) {
    return { lines: [], error: err.message };
  }
}
