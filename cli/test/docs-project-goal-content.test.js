import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

const CLI_DOCS = read('website-v2/docs/cli.mdx');
const REPORT_DOCS = read('website-v2/docs/governance-report.mdx');
const CLI_ENTRY = read('cli/bin/agentxchain.js');
const PROJECT_GOAL_SPEC = read('.planning/PROJECT_GOAL_SPEC.md');

describe('project goal docs contract', () => {
  it('documents the init --goal flag in the CLI entrypoint and CLI docs', () => {
    assert.match(CLI_ENTRY, /--goal <text>/);
    assert.match(CLI_DOCS, /--goal <text>/);
    assert.match(CLI_DOCS, /persisted in `project\.goal`/);
  });

  it('documents status and dispatch-bundle goal visibility in CLI docs', () => {
    assert.match(CLI_DOCS, /status --json.*project_goal/s);
    assert.match(CLI_DOCS, /Goal: <text>/);
    assert.match(CLI_DOCS, /## Project Goal/);
  });

  it('documents report goal visibility in CLI and governance-report docs', () => {
    assert.match(CLI_DOCS, /subject\.project\.goal/);
    assert.match(REPORT_DOCS, /subject\.project\.goal/);
    assert.match(REPORT_DOCS, /Goal: <text>/);
  });
});

describe('project goal spec alignment', () => {
  it('keeps the frozen spec aligned to the shipped report and export shapes', () => {
    assert.match(PROJECT_GOAL_SPEC, /subject\.project\.goal/);
    assert.match(PROJECT_GOAL_SPEC, /summary\.project_goal/);
    assert.match(PROJECT_GOAL_SPEC, /AT-PG-007/);
  });
});
