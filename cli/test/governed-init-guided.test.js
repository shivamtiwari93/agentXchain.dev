import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { buildGovernedTemplateChoices, resolveGovernedInitAnswers } from '../src/commands/init.js';

const ROOT = resolve(import.meta.dirname, '..');
const CLI = resolve(ROOT, 'bin', 'agentxchain.js');
const REPO_README = readFileSync(resolve(ROOT, '..', 'README.md'), 'utf8');
const CLI_README = readFileSync(resolve(ROOT, 'README.md'), 'utf8');

describe('guided governed init prompts', () => {
  it('AT-GGI-001: prompts for template and goal when omitted', async () => {
    const promptCalls = [];
    const answers = [
      { template: 'web-app' },
      { name: 'Customer Portal' },
      { goal: 'Ship a governed customer portal MVP' },
      { folder: 'customer-portal' },
    ];

    const result = await resolveGovernedInitAnswers({}, async (questions) => {
      promptCalls.push(questions[0]);
      return answers.shift();
    });

    assert.equal(result.templateId, 'web-app');
    assert.equal(result.projectName, 'Customer Portal');
    assert.equal(result.goal, 'Ship a governed customer portal MVP');
    assert.equal(result.folderName, 'customer-portal');
    assert.deepEqual(promptCalls.map((question) => question.name), ['template', 'name', 'goal', 'folder']);
  });

  it('AT-GGI-002: skips template and goal prompts when flags are already provided', async () => {
    const promptCalls = [];
    const result = await resolveGovernedInitAnswers(
      { template: 'library', goal: 'Build a reusable SDK', dir: 'customer-sdk' },
      async (questions) => {
        promptCalls.push(questions[0]);
        return { name: 'Customer SDK' };
      },
    );

    assert.equal(result.templateId, 'library');
    assert.equal(result.projectName, 'Customer SDK');
    assert.equal(result.goal, 'Build a reusable SDK');
    assert.equal(result.folderName, 'customer-sdk');
    assert.deepEqual(promptCalls.map((question) => question.name), ['name']);
  });

  it('AT-GGI-003: blank guided goal input stays unset', async () => {
    const answers = [
      { template: 'generic' },
      { name: 'Blank Goal Project' },
      { goal: '   ' },
      { folder: 'blank-goal-project' },
    ];

    const result = await resolveGovernedInitAnswers({}, async () => answers.shift());
    assert.equal(result.goal, undefined);
  });

  it('AT-GGI-004: template choices come from governed template manifests', () => {
    const choices = buildGovernedTemplateChoices();
    const ids = choices.map((choice) => choice.value);

    assert.deepEqual(ids, ['generic', 'api-service', 'cli-tool', 'library', 'web-app', 'full-local-cli', 'enterprise-app']);
    assert.match(choices[0].name, /Generic/);
    assert.match(choices[4].name, /Web App/);
    assert.match(choices[5].name, /Full Local CLI/);
    assert.match(choices[6].name, /Enterprise App/);
  });
});

describe('guided governed init CLI surface', () => {
  it('AT-GGI-005: init --help describes -y as skipping guided prompts', () => {
    const result = spawnSync(process.execPath, [CLI, 'init', '--help'], {
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Skip guided prompts, use defaults/);
  });

  it('AT-GGI-006: successful init echoes the selected goal', () => {
    const tmp = mkdtempSync(resolve(tmpdir(), 'ggi-006-'));
    try {
      const out = execSync(
        `node "${CLI}" init --governed --goal "Ship a governed SDK release flow" --dir "${tmp}" -y`,
        { encoding: 'utf8', timeout: 15000 },
      ).toString();

      assert.match(out, /Goal:\s+Ship a governed SDK release flow/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('guided governed init front-door docs', () => {
  it('AT-GGI-007: both READMEs describe init --governed as a guided scaffold', () => {
    assert.match(REPO_README, /Run `agentxchain init --governed` for the guided scaffold/);
    assert.match(CLI_README, /Run `agentxchain init --governed` for the guided scaffold/);
  });
});
