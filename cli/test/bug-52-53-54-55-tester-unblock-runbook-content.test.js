import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const RUNBOOK_PATH = '.planning/BUG_52_53_54_55_TESTER_UNBLOCK_RUNBOOK.md';
const SPEC_PATH = '.planning/BUG_52_53_54_55_TESTER_UNBLOCK_RUNBOOK_SPEC.md';
const RUNBOOK = readFileSync(join(REPO_ROOT, RUNBOOK_PATH), 'utf8');
const SPEC = readFileSync(join(REPO_ROOT, SPEC_PATH), 'utf8');
const NORMALIZED_RUNBOOK = RUNBOOK.replace(/\s+/g, ' ');

function escapedRegExp(text) {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

describe('BUG-52/53/54/55 tester unblock runbook content', () => {
  it('has a spec with the required planning sections', () => {
    for (const section of [
      '## Purpose',
      '## Interface',
      '## Behavior',
      '## Error Cases',
      '## Acceptance Tests',
      '## Open Questions',
    ]) {
      assert.match(SPEC, escapedRegExp(section), `${SPEC_PATH} must include ${section}`);
    }
  });

  it('stays compact enough for tester quote-back', () => {
    const nonEmptyLines = RUNBOOK.split('\n').filter((line) => line.trim()).length;
    assert.ok(
      nonEmptyLines <= 60,
      `${RUNBOOK_PATH} must stay under 60 non-empty lines; got ${nonEmptyLines}`,
    );
  });

  it('pins BUG-52 to the canonical shipped-package runbook and proof location', () => {
    assert.match(RUNBOOK, /agentxchain@2\.154\.7/);
    assert.match(RUNBOOK, /BUG_52_TESTER_QUOTEBACK_RUNBOOK\.md/);
    assert.match(RUNBOOK, /agentxchain --version/);
    assert.match(RUNBOOK, /git rev-parse --show-toplevel/);
    assert.match(RUNBOOK, /\.planning\/AGENT-TALK\.md/);
    assert.match(NORMALIZED_RUNBOOK, /beta bug thread/i);
    assert.doesNotMatch(RUNBOOK, /agentxchain@2\.150\.0/);
  });

  it('names the four evidence commands for the four open bugs', () => {
    for (const command of [
      "sed -n '1,220p' .planning/BUG_52_TESTER_QUOTEBACK_RUNBOOK.md",
      'agentxchain run --continuous --max-runs 3',
      'REPRO="$(npm root)/agentxchain/scripts/reproduce-bug-54.mjs"',
      '[ -f "$REPRO" ] || REPRO="$(npm root -g)/agentxchain/scripts/reproduce-bug-54.mjs"',
      'node "$REPRO" --attempts 10 --watchdog-ms 180000 --out /tmp/bug54-latest.json',
      'agentxchain accept-turn --turn <qa_turn_id> && agentxchain checkpoint-turn --turn <qa_turn_id> && git status --short',
    ]) {
      assert.match(RUNBOOK, escapedRegExp(command), `runbook must include command: ${command}`);
    }
  });

  it('locks BUG-52 quote fields across planning and QA lanes', () => {
    for (const marker of [
      'planning_signoff',
      'qa_ship_verdict',
      'phase_entered',
      'trigger: "reconciled_before_dispatch"',
      'gate_passed',
      'negative counter-case',
      'Planning must dispatch `dev`',
      'QA must dispatch `launch`',
      '.agentxchain/state.json',
    ]) {
      assert.match(
        NORMALIZED_RUNBOOK,
        escapedRegExp(marker),
        `BUG-52 marker missing: ${marker}`,
      );
    }
  });

  it('locks BUG-53 continuous auto-chain quote fields', () => {
    for (const marker of [
      'session_continuation <previous_run_id> -> <next_run_id>',
      '.agentxchain/continuous-session.json.status',
      'runs_completed',
      'paused',
    ]) {
      assert.match(RUNBOOK, escapedRegExp(marker), `BUG-53 marker missing: ${marker}`);
    }
  });

  it('resolves the BUG-54 repro script from an installed package, not the repo layout', () => {
    // Testers reproduce BUG-54 inside their own project worktree where the
    // `cli/` directory does not exist. The runbook must resolve the script
    // out of the installed `agentxchain` package so the command works as-is
    // against the installed `agentxchain` package. Guard against regressing to the
    // repo-relative path.
    assert.doesNotMatch(
      RUNBOOK,
      /(^|[^"\w])node\s+cli\/scripts\/reproduce-bug-54\.mjs/m,
      'runbook must not tell testers to run node cli/scripts/reproduce-bug-54.mjs; that path exists only in the agentXchain.dev repo',
    );
  });

  it('locks BUG-54 discriminator quote fields', () => {
    for (const marker of [
      'command_probe.status',
      'command_probe.stdout',
      'summary.spawn_attached',
      'summary.stdout_attached',
      'summary.watchdog_fires',
      'summary.classification_counts',
      'summary.success_rate_first_stdout',
      'first_stdout_ms',
      'first_stderr_ms',
      'stdout_bytes_total',
      'stderr_bytes_total',
      'watchdog_fired',
      'exit_signal',
      'env_snapshot.auth_env_present',
      'spawn_shape',
    ]) {
      assert.match(RUNBOOK, escapedRegExp(marker), `BUG-54 marker missing: ${marker}`);
    }
  });

  it('locks BUG-55 checkpoint quote fields and failure markers', () => {
    for (const marker of [
      'checkpoint SHA',
      'files_changed',
      'verification.produced_files',
      'git status --short',
      'undeclared_verification_outputs',
      'divergent_from_accepted_lineage',
    ]) {
      assert.match(RUNBOOK, escapedRegExp(marker), `BUG-55 marker missing: ${marker}`);
    }
  });
});
