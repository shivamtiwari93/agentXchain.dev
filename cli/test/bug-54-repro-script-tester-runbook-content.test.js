import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function read(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

const RUNBOOK_PATH = '.planning/BUG_54_REPRO_SCRIPT_TESTER_RUNBOOK.md';

describe('BUG-54 reproduction script tester runbook content (Turn 97)', () => {
  const RUNBOOK = read(RUNBOOK_PATH);

  it('names the script path operators run', () => {
    assert.match(
      RUNBOOK,
      /cli\/scripts\/reproduce-bug-54\.mjs/,
      'runbook must name the script path',
    );
  });

  it('includes the canonical --synthetic invocation with --attempts and --out', () => {
    assert.match(
      RUNBOOK,
      /node cli\/scripts\/reproduce-bug-54\.mjs[\s\S]*--synthetic[\s\S]*--attempts[\s\S]*--out/,
      'runbook must document the canonical tester invocation',
    );
  });

  it('maps every locked classification bucket to hypothesis triage guidance', () => {
    for (const bucket of [
      'spawn_error_pre_process',
      'spawn_attach_failed',
      'spawn_unattached',
      'watchdog_no_output',
      'watchdog_stderr_only',
      'exit_no_output',
      'exit_stderr_only',
      'exit_clean_with_stdout',
      'exit_nonzero_with_stdout',
    ]) {
      assert.match(
        RUNBOOK,
        new RegExp(bucket),
        `runbook must map classification bucket ${bucket}`,
      );
    }
  });

  it('names every BUG-54 hypothesis by number', () => {
    for (const marker of [
      'Hypothesis 2',
      'Hypothesis 3',
      'Hypothesis 4',
      'Hypothesis 5',
      'Hypothesis 1',
    ]) {
      assert.match(
        RUNBOOK,
        new RegExp(marker),
        `runbook must name ${marker}`,
      );
    }
  });

  it('documents the Turn 96 healthy reference shape without embedding secrets', () => {
    assert.match(RUNBOOK, /exit_clean_with_stdout/);
    assert.match(RUNBOOK, /avg_first_stdout_ms/);
    assert.match(RUNBOOK, /watchdog_fires/);
    assert.match(
      RUNBOOK,
      /auth env booleans are diagnostic context only/i,
      'runbook must explicitly state auth env booleans are not standalone proof',
    );
  });

  it('tells the tester exactly what to quote back', () => {
    assert.match(
      RUNBOOK,
      /What to quote back to the agents/i,
      'runbook must contain the quote-back section',
    );
    assert.match(RUNBOOK, /env_snapshot\.auth_env_present/);
    assert.match(RUNBOOK, /resolved_command/);
    assert.match(RUNBOOK, /resolved_args_redacted/);
    assert.match(RUNBOOK, /prompt_transport/);
  });

  it('is referenced from the current v2.148.0 release notes tester rerun contract', () => {
    const releaseNotes = read('website-v2/docs/releases/v2-148-0.mdx');
    assert.match(
      releaseNotes,
      /reproduce-bug-54\.mjs/,
      'v2.148.0 release notes must reference the repro script',
    );
    assert.match(
      releaseNotes,
      /BUG_54_REPRO_SCRIPT_TESTER_RUNBOOK\.md/,
      'v2.148.0 release notes must link operators to the runbook by filename',
    );
  });
});
