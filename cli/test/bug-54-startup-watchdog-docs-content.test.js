/**
 * BUG-54 startup-watchdog operator-facing docs — content regression.
 *
 * Turn 193 landed `website-v2/docs/local-cli-recipes.mdx#startup-watchdog-and-diagnostics`
 * to close BUG-54 fix requirement #3: document the 180s default startup
 * watchdog, when to raise/lower it per runtime, and how to inspect the
 * `spawn_attached` / `first_output` / `startup_watchdog_fired` diagnostics
 * from `.agentxchain/dispatch/turns/<turnId>/stdout.log`.
 *
 * This test locks the operator-facing contract so a future docs pass cannot
 * silently drop the default value, the override fields, or the three
 * diagnostic labels — any of which would re-strand operators the same way the
 * BUG-52 runbook jq bug stranded them (Turn 191).
 *
 * Shape guard only: no product-code assertions. Paired with
 * `cli/test/beta-tester-scenarios/bug-54-watchdog-threshold-default.test.js`
 * (numeric default) and `bug-54-realistic-bundle-watchdog.test.js` (adapter
 * behavior).
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const RECIPES_PATH = 'website-v2/docs/local-cli-recipes.mdx';
const RECIPES = readFileSync(join(REPO_ROOT, RECIPES_PATH), 'utf8');

describe('BUG-54 startup-watchdog operator docs (local-cli-recipes.mdx)', () => {
  it('has a dedicated "Startup watchdog and diagnostics" section', () => {
    assert.match(
      RECIPES,
      /^## Startup watchdog and diagnostics$/m,
      'local-cli-recipes must expose a top-level section named "Startup watchdog and diagnostics"',
    );
  });

  it('names the 180 second / 180000 ms default', () => {
    assert.match(RECIPES, /\b180 seconds\b/);
    assert.match(RECIPES, /`180000`/);
  });

  it('documents both per-runtime and global override fields with the correct names', () => {
    assert.match(
      RECIPES,
      /runtimes\.<id>\.startup_watchdog_ms/,
      'per-runtime override field name must match the schema',
    );
    assert.match(
      RECIPES,
      /run_loop\.startup_watchdog_ms/,
      'global override field name must match the schema',
    );
  });

  it('states the per-runtime > global > default precedence', () => {
    assert.match(
      RECIPES,
      /per-runtime\s*>\s*global\s*>\s*default/i,
      'docs must state override precedence so operators pick the right scope',
    );
  });

  it('has a "When to raise" guidance block', () => {
    assert.match(RECIPES, /^### When to raise$/m);
  });

  it('has a "When to lower" guidance block', () => {
    assert.match(RECIPES, /^### When to lower$/m);
  });

  it('names all four startup adapter diagnostic labels', () => {
    for (const label of ['spawn_attached', 'first_output', 'startup_watchdog_fired', 'startup_watchdog_sigkill']) {
      assert.ok(
        RECIPES.includes(label),
        `docs must reference the '${label}' diagnostic label so operators can grep for it`,
      );
    }
  });

  it('states that stderr-only output is diagnostic evidence, not startup proof', () => {
    assert.match(
      RECIPES,
      /Stderr is diagnostic evidence only; stderr by itself does not prove the governed turn started\./,
      'docs must not claim stderr clears the startup watchdog; DEC-BUG54-STDERR-IS-NOT-STARTUP-PROOF-002 says stderr-only startup is still a failed start',
    );
    assert.doesNotMatch(
      RECIPES,
      /stdout\/stderr byte/,
      'docs must not describe stderr as first-output proof',
    );
    assert.match(
      RECIPES,
      /stream` \(`stdout` \\?\| `staged_result`\)/,
      'first_output payload docs must list only startup-proof streams',
    );
  });

  it('gives a p99-based rule of thumb for tuning slow runtimes', () => {
    assert.match(
      RECIPES,
      /max\(p99 \+ 30000, ceil\(p99 \* 1\.5\)\)/,
      'docs must give operators a concrete p99-based starting point rather than vague "raise if slow" guidance',
    );
    assert.match(
      RECIPES,
      /at least 30s of headroom/,
      'docs must tell operators to keep headroom when lowering below the default',
    );
  });

  it('names the dispatch log path where diagnostics are written', () => {
    assert.match(
      RECIPES,
      /\.agentxchain\/dispatch\/turns\/<turnId>\/stdout\.log/,
      'docs must name the stdout.log path so operators know where to look',
    );
  });

  it('shows the events command for finding startup-failure turns before grepping dispatch logs', () => {
    assert.match(
      RECIPES,
      /agentxchain events --type turn_start_failed,runtime_spawn_failed,stdout_attach_failed --limit 20 --json/,
      'docs must point operators at events.jsonl-backed triage before requiring a known turn id',
    );
  });

  it('names the [adapter:diag] log-line prefix so grep recipes work verbatim', () => {
    assert.match(
      RECIPES,
      /\[adapter:diag\]/,
      'docs must name the exact diagnostic log prefix emitted by the adapter',
    );
  });

  it('documents the BUG-54 historical context (old 30s default)', () => {
    assert.match(
      RECIPES,
      /agentxchain@2\.151\.0/,
      'docs must reference the release where the watchdog default changed',
    );
    assert.match(
      RECIPES,
      /\b30,?000 ms\b|\b30s\b|\b30 seconds\b|`startup_watchdog_ms: 30000`/,
      'docs must name the prior 30s default so operators know to unpin inherited overrides',
    );
  });

  it('cross-links from the "Turn times out or hangs" troubleshooting entry', () => {
    const linkIdx = RECIPES.indexOf('#startup-watchdog-and-diagnostics');
    assert.ok(
      linkIdx >= 0,
      'troubleshooting copy must link to #startup-watchdog-and-diagnostics so operators find the tuning guidance',
    );
  });
});
