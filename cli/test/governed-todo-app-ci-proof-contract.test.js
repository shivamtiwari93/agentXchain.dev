/**
 * Governed Todo App CI Proof Contract Test
 *
 * Guards the durable unattended product-example proof boundary:
 *   1. dedicated workflow exists
 *   2. workflow runs the real harness in text and JSON modes
 *   3. workflow injects ANTHROPIC_API_KEY
 *   4. workflow is restricted to trusted, low-frequency triggers
 *   5. docs and README name the workflow-backed CI proof path
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const CLI_ROOT = join(import.meta.dirname, '..');
const REPO_ROOT = join(CLI_ROOT, '..');
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'governed-todo-app-proof.yml');
const SPEC_PATH = join(REPO_ROOT, '.planning', 'GOVERNED_TODO_APP_CI_PROOF_SPEC.md');
const DOC_PATH = join(REPO_ROOT, 'website-v2', 'docs', 'examples', 'governed-todo-app.mdx');
const README_PATH = join(REPO_ROOT, 'examples', 'governed-todo-app', 'README.md');

const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
const doc = readFileSync(DOC_PATH, 'utf8');
const readme = readFileSync(README_PATH, 'utf8');

describe('Governed todo app CI proof: workflow contract', () => {
  it('AT-TODO-CI-001: dedicated workflow exists', () => {
    assert.ok(existsSync(WORKFLOW_PATH), 'governed-todo-app-proof.yml must exist');
  });

  it('AT-TODO-CI-002: workflow runs the real harness in text and JSON modes', () => {
    assert.match(workflow, /node examples\/governed-todo-app\/run-auto\.mjs$/m);
    assert.match(workflow, /node examples\/governed-todo-app\/run-auto\.mjs --json/);
  });

  it('AT-TODO-CI-003: workflow injects ANTHROPIC_API_KEY', () => {
    assert.match(workflow, /secrets\.ANTHROPIC_API_KEY/);
    assert.match(workflow, /ANTHROPIC_API_KEY:/);
  });

  it('AT-TODO-CI-004: workflow is restricted to nightly schedule and workflow_dispatch', () => {
    assert.doesNotMatch(workflow, /^\s+push:/m);
    assert.match(workflow, /schedule:\s*\n\s*-\s*cron: '0 7 \* \* \*'/);
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /github\.event_name == 'workflow_dispatch' \|\| github\.event_name == 'schedule'/);
  });

  it('AT-TODO-CI-005: spec exists', () => {
    assert.ok(existsSync(SPEC_PATH), 'GOVERNED_TODO_APP_CI_PROOF_SPEC.md must exist');
  });
});

describe('Governed todo app CI proof: docs contract', () => {
  it('AT-TODO-CI-006: website doc names the workflow-backed CI proof path', () => {
    assert.match(doc, /\.github\/workflows\/governed-todo-app-proof\.yml/);
    assert.match(doc, /nightly schedule and manual `workflow_dispatch` reruns/);
  });

  it('AT-TODO-CI-007: example README names the workflow-backed CI proof path', () => {
    assert.match(readme, /\.github\/workflows\/governed-todo-app-proof\.yml/);
    assert.match(readme, /nightly schedule and manual `workflow_dispatch` reruns/);
  });
});
