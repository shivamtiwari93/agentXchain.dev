import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

export function validateProject(root, config, opts = {}) {
  const mode = opts.mode || 'full';
  const expectedAgent = opts.expectedAgent || null;
  const talkFile = config.talk_file || 'TALK.md';

  const errors = [];
  const warnings = [];

  const mustExist = [
    '.planning/PROJECT.md',
    '.planning/REQUIREMENTS.md',
    '.planning/ROADMAP.md',
    '.planning/PM_SIGNOFF.md',
    '.planning/qa/TEST-COVERAGE.md',
    '.planning/qa/BUGS.md',
    '.planning/qa/UX-AUDIT.md',
    '.planning/qa/ACCEPTANCE-MATRIX.md',
    '.planning/qa/REGRESSION-LOG.md',
    talkFile,
    'state.md',
    'history.jsonl',
    'lock.json',
    'state.json'
  ];

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
  const historyPath = join(root, 'history.jsonl');
  if (!existsSync(historyPath)) {
    result.errors.push('history.jsonl is missing.');
    return result;
  }

  const lines = (readFileSync(historyPath, 'utf8') || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    if (opts.requireEntry) {
      result.errors.push('history.jsonl has no entries.');
    } else {
      result.warnings.push('history.jsonl has no entries yet.');
    }
    return result;
  }

  const lastRaw = lines[lines.length - 1];
  let last;
  try {
    last = JSON.parse(lastRaw);
  } catch {
    result.errors.push('Last history.jsonl entry is not valid JSON.');
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
