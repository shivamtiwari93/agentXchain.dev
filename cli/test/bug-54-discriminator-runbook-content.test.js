import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const RUNBOOK_PATH = '.planning/BUG_54_DISCRIMINATOR_RUNBOOK.md';
const RUNBOOK = readFileSync(join(REPO_ROOT, RUNBOOK_PATH), 'utf8');

function escapedRegExp(text) {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

describe('BUG-54 discriminator runbook content', () => {
  it('stays compact enough to be a quote-back checklist', () => {
    const nonEmptyLines = RUNBOOK.split('\n').filter((line) => line.trim()).length;
    assert.ok(
      nonEmptyLines <= 60,
      `${RUNBOOK_PATH} must stay under 60 non-empty lines; got ${nonEmptyLines}`,
    );
  });

  it('names every required discriminator field', () => {
    for (const field of [
      'command_probe.kind',
      'summary.spawn_attached',
      'stdout_attached',
      'watchdog_fires',
      'avg_first_stdout_ms',
      'success_rate_first_stdout',
      'summary.classification',
      'stdout_bytes',
      'stderr_bytes',
      'first_stdout_ms',
      'first_stderr_ms',
      'watchdog_fired',
      'exit_signal',
      'env_snapshot.auth_env_present',
      'resolved_command',
      'resolved_args_redacted',
      'prompt_transport',
    ]) {
      assert.match(RUNBOOK, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });

  it('resolves the source diagnostic from an installed package, not repo layout', () => {
    for (const marker of [
      'agentxchain/scripts/reproduce-bug-54.mjs',
      'npm root',
      'tester unblock runbook',
    ]) {
      assert.match(RUNBOOK, escapedRegExp(marker));
    }
    assert.doesNotMatch(
      RUNBOOK,
      /(^|[^"\w])node\s+cli\/scripts\/reproduce-bug-54\.mjs/m,
      'discriminator must not tell testers to run node cli/scripts/reproduce-bug-54.mjs; that path exists only in the agentXchain.dev repo',
    );
  });

  it('maps the key BUG-54 discriminator shapes', () => {
    for (const marker of [
      '2.1.87 (Claude Code)',
      'exit_clean_with_stdout',
      'watchdog_no_output',
      '--no-watchdog',
      '--watchdog-ms 120000',
      'resource accumulation',
      'watchdog_stderr_only',
      'exit_stderr_only',
      'Auth env booleans are context only',
    ]) {
      assert.match(RUNBOOK, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    }
  });
});
