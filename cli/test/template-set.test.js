import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function run(args, cwd) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    timeout: 15000,
  });
}

function makeGovernedProject(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'axc-template-set-'));
  mkdirSync(join(dir, '.agentxchain', 'prompts'), { recursive: true });
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(dir, '.planning'), { recursive: true });

  const config = {
    schema_version: '1.0',
    template: overrides.template || 'generic',
    project: { id: 'test-proj', name: 'Test Project', default_branch: 'main' },
    roles: {
      pm: { title: 'PM', mandate: 'Protect value.', write_authority: 'review_only', runtime: 'manual-pm' },
      dev: { title: 'Dev', mandate: 'Implement.', write_authority: 'authoritative', runtime: 'local-dev' },
      qa: { title: 'QA', mandate: 'Challenge.', write_authority: 'review_only', runtime: 'api-qa' },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'local-dev': { type: 'local_cli', command: ['echo'], cwd: '.' },
      'api-qa': { type: 'api_proxy', provider: 'anthropic', model: 'claude-sonnet-4-6', auth_env: 'ANTHROPIC_API_KEY' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa'], exit_gate: 'implementation_complete' },
      qa: { entry_role: 'qa', allowed_next_roles: ['dev', 'qa'], exit_gate: 'qa_ship_verdict' },
    },
    gates: {
      planning_signoff: { requires_human_approval: true },
      implementation_complete: { requires_verification_pass: true },
      qa_ship_verdict: { requires_human_approval: true },
    },
    prompts: {
      pm: '.agentxchain/prompts/pm.md',
      dev: '.agentxchain/prompts/dev.md',
      qa: '.agentxchain/prompts/qa.md',
    },
    rules: { challenge_required: true, max_turn_retries: 2 },
    ...overrides.configOverrides,
  };

  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2) + '\n');
  writeFileSync(join(dir, '.agentxchain', 'decision-ledger.jsonl'), '');

  // Write prompt files
  writeFileSync(join(dir, '.agentxchain', 'prompts', 'pm.md'), '# PM Prompt\nBase prompt content.\n');
  writeFileSync(join(dir, '.agentxchain', 'prompts', 'dev.md'), '# Dev Prompt\nBase prompt content.\n');
  writeFileSync(join(dir, '.agentxchain', 'prompts', 'qa.md'), '# QA Prompt\nBase prompt content.\n');

  // Write acceptance matrix
  writeFileSync(join(dir, '.planning', 'acceptance-matrix.md'), '# Acceptance Matrix — Test Project\n\n| Req | Status |\n|-----|--------|\n');

  return dir;
}

// ── AT-TEMPLATE-SET-001: Config field update ────────────────────────────────
describe('template set — config update', () => {
  it('AT-001: updates agentxchain.json template field to the target id', () => {
    const dir = makeGovernedProject();
    const result = run(['template', 'set', 'api-service', '--yes'], dir);
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(readFileSync(join(dir, 'agentxchain.json'), 'utf8'));
    assert.equal(config.template, 'api-service');
    rmSync(dir, { recursive: true, force: true });
  });
});

// ── AT-TEMPLATE-SET-002: Creates all planning artifacts ─────────────────────
describe('template set — planning artifacts creation', () => {
  it('AT-002: creates all planning artifacts from the manifest when none exist', () => {
    const dir = makeGovernedProject();
    const result = run(['template', 'set', 'api-service', '--yes'], dir);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(join(dir, '.planning', 'api-contract.md')));
    assert.ok(existsSync(join(dir, '.planning', 'operational-readiness.md')));
    assert.ok(existsSync(join(dir, '.planning', 'error-budget.md')));
    // Verify content interpolation
    const content = readFileSync(join(dir, '.planning', 'api-contract.md'), 'utf8');
    assert.ok(content.includes('Test Project'), 'project name should be interpolated');
    rmSync(dir, { recursive: true, force: true });
  });

  it('AT-002b: creates all library planning artifacts when library template is selected', () => {
    const dir = makeGovernedProject();
    const result = run(['template', 'set', 'library', '--yes'], dir);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(join(dir, '.planning', 'public-api.md')));
    assert.ok(existsSync(join(dir, '.planning', 'compatibility-policy.md')));
    assert.ok(existsSync(join(dir, '.planning', 'release-adoption.md')));
    const content = readFileSync(join(dir, '.planning', 'public-api.md'), 'utf8');
    assert.ok(content.includes('Test Project'), 'project name should be interpolated');
    rmSync(dir, { recursive: true, force: true });
  });
});

// ── AT-TEMPLATE-SET-003: Skips existing artifacts ───────────────────────────
describe('template set — existing artifacts preserved', () => {
  it('AT-003: skips planning artifacts that already exist, preserving content byte-for-byte', () => {
    const dir = makeGovernedProject();
    const existingContent = '# My custom API contract\nDo not overwrite this.\n';
    writeFileSync(join(dir, '.planning', 'api-contract.md'), existingContent);
    const result = run(['template', 'set', 'api-service', '--yes'], dir);
    assert.equal(result.status, 0, result.stderr);
    const preserved = readFileSync(join(dir, '.planning', 'api-contract.md'), 'utf8');
    assert.equal(preserved, existingContent, 'existing file should be preserved byte-for-byte');
    // Other artifacts should still be created
    assert.ok(existsSync(join(dir, '.planning', 'operational-readiness.md')));
    rmSync(dir, { recursive: true, force: true });
  });
});

// ── AT-TEMPLATE-SET-004: Appends prompt overrides ───────────────────────────
describe('template set — prompt overrides', () => {
  it('AT-004: appends prompt overrides to role prompts that lack the guidance section', () => {
    const dir = makeGovernedProject();
    const result = run(['template', 'set', 'api-service', '--yes'], dir);
    assert.equal(result.status, 0, result.stderr);
    const pmPrompt = readFileSync(join(dir, '.agentxchain', 'prompts', 'pm.md'), 'utf8');
    assert.ok(pmPrompt.includes('## Project-Type-Specific Guidance'), 'should have guidance section');
    assert.ok(pmPrompt.includes('external contract'), 'should contain api-service pm override');
    assert.ok(pmPrompt.startsWith('# PM Prompt'), 'original content should be preserved');
    rmSync(dir, { recursive: true, force: true });
  });
});

// ── AT-TEMPLATE-SET-005: Skips prompts that already have guidance ────────────
describe('template set — prompt override idempotency', () => {
  it('AT-005: skips prompt append when guidance section already exists', () => {
    const dir = makeGovernedProject();
    const promptWithGuidance = '# PM Prompt\nBase content.\n\n---\n\n## Project-Type-Specific Guidance\n\nExisting override.\n';
    writeFileSync(join(dir, '.agentxchain', 'prompts', 'pm.md'), promptWithGuidance);
    const result = run(['template', 'set', 'api-service', '--yes'], dir);
    assert.equal(result.status, 0, result.stderr);
    const preserved = readFileSync(join(dir, '.agentxchain', 'prompts', 'pm.md'), 'utf8');
    assert.equal(preserved, promptWithGuidance, 'prompt with existing guidance should be preserved');
    rmSync(dir, { recursive: true, force: true });
  });
});

// ── AT-TEMPLATE-SET-006: Appends acceptance hints ───────────────────────────
describe('template set — acceptance hints', () => {
  it('AT-006: appends acceptance hints when Template Guidance section does not exist', () => {
    const dir = makeGovernedProject();
    const result = run(['template', 'set', 'api-service', '--yes'], dir);
    assert.equal(result.status, 0, result.stderr);
    const matrix = readFileSync(join(dir, '.planning', 'acceptance-matrix.md'), 'utf8');
    assert.ok(matrix.includes('## Template Guidance'), 'should have template guidance section');
    assert.ok(matrix.includes('API contract reviewed'), 'should contain api-service acceptance hints');
    rmSync(dir, { recursive: true, force: true });
  });
});

// ── AT-TEMPLATE-SET-007: Skips acceptance hints when already present ────────
describe('template set — acceptance hints idempotency', () => {
  it('AT-007: skips acceptance hints when Template Guidance section already exists', () => {
    const dir = makeGovernedProject();
    const matrixWithHints = '# Acceptance Matrix\n\n## Template Guidance\n- [ ] Existing hint\n';
    writeFileSync(join(dir, '.planning', 'acceptance-matrix.md'), matrixWithHints);
    const result = run(['template', 'set', 'api-service', '--yes'], dir);
    assert.equal(result.status, 0, result.stderr);
    const preserved = readFileSync(join(dir, '.planning', 'acceptance-matrix.md'), 'utf8');
    assert.equal(preserved, matrixWithHints, 'acceptance matrix with existing hints should be preserved');
    rmSync(dir, { recursive: true, force: true });
  });
});

// ── AT-TEMPLATE-SET-008: Unknown template ID ────────────────────────────────
describe('template set — unknown template', () => {
  it('AT-008: exits with code 1 and lists valid template IDs', () => {
    const dir = makeGovernedProject();
    const result = run(['template', 'set', 'nonexistent', '--yes'], dir);
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes('Unknown template') || result.stdout.includes('Unknown template'));
    const output = result.stderr + result.stdout;
    assert.ok(output.includes('generic'), 'should list valid templates');
    assert.ok(output.includes('api-service'), 'should list valid templates');
    rmSync(dir, { recursive: true, force: true });
  });
});

// ── AT-TEMPLATE-SET-009: Non-governed project ───────────────────────────────
describe('template set — non-governed project', () => {
  it('AT-009: exits with code 1 on a non-governed project', () => {
    const dir = mkdtempSync(join(tmpdir(), 'axc-template-set-nongov-'));
    // Write a v3 config (schema_version 3)
    writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify({ schema_version: 3, agents: {} }) + '\n');
    const result = run(['template', 'set', 'api-service', '--yes'], dir);
    assert.equal(result.status, 1);
    const output = result.stderr + result.stdout;
    assert.ok(output.includes('not a governed project') || output.includes('governed'), 'should mention governed requirement');
    rmSync(dir, { recursive: true, force: true });
  });

  it('AT-009b: exits with code 1 when no agentxchain.json exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'axc-template-set-noconf-'));
    const result = run(['template', 'set', 'api-service', '--yes'], dir);
    assert.equal(result.status, 1);
    const output = result.stderr + result.stdout;
    assert.ok(output.includes('No agentxchain.json'));
    rmSync(dir, { recursive: true, force: true });
  });

  it('AT-009c: exits with code 1 when governed workspace directory is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'axc-template-set-nostate-'));
    const config = {
      schema_version: '1.1',
      template: 'generic',
      project: { id: 'test-proj', name: 'Test Project', default_branch: 'main' },
      roles: {},
      runtimes: {},
      routing: {},
      gates: {},
      prompts: {},
      rules: { challenge_required: true, max_turn_retries: 2 },
    };
    writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2) + '\n');

    const result = run(['template', 'set', 'api-service', '--yes'], dir);
    assert.equal(result.status, 1);
    const output = result.stderr + result.stdout;
    assert.ok(output.includes('Governed workspace missing'));
    rmSync(dir, { recursive: true, force: true });
  });
});

// ── AT-TEMPLATE-SET-010: Same template no-op ────────────────────────────────
describe('template set — same template no-op', () => {
  it('AT-010: prints "Already set" and exits 0 with no writes', () => {
    const dir = makeGovernedProject({ template: 'api-service' });
    const configBefore = readFileSync(join(dir, 'agentxchain.json'), 'utf8');
    const result = run(['template', 'set', 'api-service', '--yes'], dir);
    assert.equal(result.status, 0);
    assert.ok(result.stdout.includes('Already set'));
    const configAfter = readFileSync(join(dir, 'agentxchain.json'), 'utf8');
    assert.equal(configBefore, configAfter, 'config should not change on no-op');
    rmSync(dir, { recursive: true, force: true });
  });
});

// ── AT-TEMPLATE-SET-011: Cross-template switching ───────────────────────────
describe('template set — cross-template switching', () => {
  it('AT-011: switching from api-service to web-app updates field, creates new artifacts, keeps old artifacts, warns about existing prompts', () => {
    const dir = makeGovernedProject({ template: 'api-service' });
    // Simulate api-service artifacts from init
    writeFileSync(join(dir, '.planning', 'api-contract.md'), '# API Contract\n');
    writeFileSync(join(dir, '.planning', 'operational-readiness.md'), '# Operational Readiness\n');
    // Add existing prompt guidance (from api-service init)
    writeFileSync(join(dir, '.agentxchain', 'prompts', 'pm.md'),
      '# PM\nBase.\n\n---\n\n## Project-Type-Specific Guidance\n\nAPI guidance.\n');
    writeFileSync(join(dir, '.planning', 'acceptance-matrix.md'),
      '# Matrix\n\n## Template Guidance\n- [ ] Old hints\n');

    const result = run(['template', 'set', 'web-app', '--yes'], dir);
    assert.equal(result.status, 0, result.stderr);

    // Template field updated
    const config = JSON.parse(readFileSync(join(dir, 'agentxchain.json'), 'utf8'));
    assert.equal(config.template, 'web-app');

    // New web-app artifacts created
    assert.ok(existsSync(join(dir, '.planning', 'user-flows.md')));
    assert.ok(existsSync(join(dir, '.planning', 'ui-acceptance.md')));
    assert.ok(existsSync(join(dir, '.planning', 'browser-support.md')));

    // Old api-service artifacts NOT deleted
    assert.ok(existsSync(join(dir, '.planning', 'api-contract.md')));
    assert.ok(existsSync(join(dir, '.planning', 'operational-readiness.md')));

    // Prompt not double-appended (already has guidance)
    const pmPrompt = readFileSync(join(dir, '.agentxchain', 'prompts', 'pm.md'), 'utf8');
    assert.ok(pmPrompt.includes('API guidance'), 'old guidance preserved');
    const guidanceCount = pmPrompt.split('## Project-Type-Specific Guidance').length - 1;
    assert.equal(guidanceCount, 1, 'guidance section should appear exactly once');

    // Warning about skipped prompts
    assert.ok(result.stdout.includes('already has project-type guidance') || result.stdout.includes('Skipping'));

    rmSync(dir, { recursive: true, force: true });
  });
});

// ── AT-TEMPLATE-SET-012: Dry run ────────────────────────────────────────────
describe('template set — dry run', () => {
  it('AT-012: prints mutation plan without writing any files', () => {
    const dir = makeGovernedProject();
    const configBefore = readFileSync(join(dir, 'agentxchain.json'), 'utf8');
    const result = run(['template', 'set', 'api-service', '--dry-run'], dir);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('WILL CREATE'));
    assert.ok(result.stdout.includes('WILL APPEND'));
    assert.ok(result.stdout.includes('No changes written'));

    // Nothing changed
    const configAfter = readFileSync(join(dir, 'agentxchain.json'), 'utf8');
    assert.equal(configBefore, configAfter, 'config should not change on dry run');
    assert.ok(!existsSync(join(dir, '.planning', 'api-contract.md')), 'artifacts should not be created');
    rmSync(dir, { recursive: true, force: true });
  });
});

// ── AT-TEMPLATE-SET-013: Decision ledger entry ──────────────────────────────
describe('template set — decision ledger', () => {
  it('AT-013: appends a template_set decision to decision-ledger.jsonl', () => {
    const dir = makeGovernedProject();
    const result = run(['template', 'set', 'api-service', '--yes'], dir);
    assert.equal(result.status, 0, result.stderr);
    const ledger = readFileSync(join(dir, '.agentxchain', 'decision-ledger.jsonl'), 'utf8').trim();
    assert.ok(ledger.length > 0, 'ledger should not be empty');
    const entry = JSON.parse(ledger.split('\n').pop());
    assert.equal(entry.type, 'template_set');
    assert.equal(entry.previous_template, 'generic');
    assert.equal(entry.new_template, 'api-service');
    assert.ok(Array.isArray(entry.files_created));
    assert.ok(entry.files_created.includes('api-contract.md'));
    assert.ok(Array.isArray(entry.prompts_appended));
    assert.equal(entry.operator, 'human');
    rmSync(dir, { recursive: true, force: true });
  });
});

// ── AT-TEMPLATE-SET-014: Idempotency (run twice) ───────────────────────────
describe('template set — idempotency', () => {
  it('AT-014: running set twice in succession is idempotent — second run reports Already set', () => {
    const dir = makeGovernedProject();
    const first = run(['template', 'set', 'api-service', '--yes'], dir);
    assert.equal(first.status, 0, first.stderr);
    const second = run(['template', 'set', 'api-service', '--yes'], dir);
    assert.equal(second.status, 0, second.stderr);
    assert.ok(second.stdout.includes('Already set'));
    rmSync(dir, { recursive: true, force: true });
  });
});

// ── AT-TEMPLATE-SET-015: Set to generic ─────────────────────────────────────
describe('template set — set to generic', () => {
  it('AT-015: setting to generic fails closed because generic is now blueprint-backed', () => {
    const dir = makeGovernedProject({ template: 'api-service' });
    writeFileSync(join(dir, '.planning', 'api-contract.md'), '# API Contract\n');
    const result = run(['template', 'set', 'generic', '--yes'], dir);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Template "generic" defines a custom governed team blueprint/);
    const config = JSON.parse(readFileSync(join(dir, 'agentxchain.json'), 'utf8'));
    assert.equal(config.template, 'api-service');
    assert.ok(existsSync(join(dir, '.planning', 'api-contract.md')));
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('template set — missing guidance targets', () => {
  it('warns when a prompt file or acceptance matrix is missing but still applies safe mutations', () => {
    const dir = makeGovernedProject();
    rmSync(join(dir, '.agentxchain', 'prompts', 'qa.md'));
    rmSync(join(dir, '.planning', 'acceptance-matrix.md'));

    const result = run(['template', 'set', 'api-service', '--yes'], dir);
    assert.equal(result.status, 0, result.stderr);

    const output = result.stdout + result.stderr;
    assert.ok(output.includes('Prompt file for qa not found'));
    assert.ok(output.includes('acceptance-matrix.md not found'));

    const config = JSON.parse(readFileSync(join(dir, 'agentxchain.json'), 'utf8'));
    assert.equal(config.template, 'api-service');
    assert.ok(existsSync(join(dir, '.planning', 'api-contract.md')));
    rmSync(dir, { recursive: true, force: true });
  });

  it('dry-run reports missing prompt files and acceptance matrix distinctly', () => {
    const dir = makeGovernedProject();
    rmSync(join(dir, '.agentxchain', 'prompts', 'qa.md'));
    rmSync(join(dir, '.planning', 'acceptance-matrix.md'));

    const result = run(['template', 'set', 'api-service', '--dry-run'], dir);
    assert.equal(result.status, 0, result.stderr);

    assert.ok(result.stdout.includes('MISSING FILE (skip)'));
    assert.ok(result.stdout.includes('.agentxchain/prompts/qa.md'));
    assert.ok(result.stdout.includes('.planning/acceptance-matrix.md'));
    rmSync(dir, { recursive: true, force: true });
  });
});

// ── template list ───────────────────────────────────────────────────────────
describe('template list', () => {
  it('lists all available templates in human-readable format', () => {
    const result = run(['template', 'list'], tmpdir());
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('generic'));
    assert.ok(result.stdout.includes('api-service'));
    assert.ok(result.stdout.includes('cli-tool'));
    assert.ok(result.stdout.includes('library'));
    assert.ok(result.stdout.includes('web-app'));
    assert.ok(result.stdout.includes('full-local-cli'));
    assert.ok(result.stdout.includes('enterprise-app'));
  });

  it('outputs JSON with --json flag', () => {
    const result = run(['template', 'list', '--json'], tmpdir());
    assert.equal(result.status, 0, result.stderr);
    const templates = JSON.parse(result.stdout);
    assert.ok(Array.isArray(templates));
    assert.equal(templates.length, 7);
    const ids = templates.map(t => t.id);
    assert.ok(ids.includes('generic'));
    assert.ok(ids.includes('api-service'));
    assert.ok(ids.includes('cli-tool'));
    assert.ok(ids.includes('library'));
    assert.ok(ids.includes('web-app'));
    assert.ok(ids.includes('full-local-cli'));
    assert.ok(ids.includes('enterprise-app'));
    // Check structure
    const apiService = templates.find(t => t.id === 'api-service');
    assert.ok(Array.isArray(apiService.planning_artifacts));
    assert.ok(apiService.planning_artifacts.includes('api-contract.md'));
    assert.ok(Array.isArray(apiService.prompt_overrides));
    assert.ok(Array.isArray(apiService.acceptance_hints));
    const enterpriseApp = templates.find(t => t.id === 'enterprise-app');
    assert.deepEqual(enterpriseApp.scaffold_blueprint_roles, ['pm', 'architect', 'dev', 'security_reviewer', 'qa', 'eng_director']);
  });
});

describe('template set — blueprint-backed templates', () => {
  it('fails closed for templates that redefine team topology', () => {
    const dir = makeGovernedProject();
    const result = run(['template', 'set', 'enterprise-app', '--yes'], dir);
    assert.equal(result.status, 1);
    const output = result.stderr + result.stdout;
    assert.ok(output.includes('custom governed team blueprint'));
    assert.ok(output.includes('init --governed --template enterprise-app'));
    rmSync(dir, { recursive: true, force: true });
  });
});
