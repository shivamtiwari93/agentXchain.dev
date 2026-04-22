/**
 * BUG-59 / BUG-54 tester quote-back docs must reference real public CLI
 * surfaces and JSONL-correct ledger commands.
 *
 * Turn 192 audited the active BUG-59/BUG-54 quote-back docs after the BUG-52
 * runbook jq defect. Two drift hazards were found:
 *   1. docs referenced `agentxchain dispatch-turn`, which is not a public CLI
 *      command in `cli/bin/agentxchain.js`.
 *   2. the checklist used a JSON-array timestamp example for
 *      `.agentxchain/decision-ledger.jsonl`, which is newline-delimited JSON.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const RUNBOOK_PATH = '.planning/BUG_59_54_TESTER_QUOTEBACK_RUNBOOK.md';
const CHECKLIST_PATH = '.planning/BUG_54_BUG_59_TESTER_QUOTEBACK_CHECKLIST.md';
const TESTER_ASK_V2_PATH = '.planning/TESTER_QUOTEBACK_ASK_V2.md';
const LEGACY_RUNBOOK_PATH = '.planning/BUG_59_54_2151_TESTER_QUOTEBACK_RUNBOOK.md';
const RELEASE_151_PATH = 'website-v2/docs/releases/v2-151-0.mdx';
const RELEASE_PAGES_WITH_BUG_54_59_FOOTERS = [
  'website-v2/docs/releases/v2-148-0.mdx',
  'website-v2/docs/releases/v2-149-0.mdx',
  'website-v2/docs/releases/v2-149-1.mdx',
  'website-v2/docs/releases/v2-149-2.mdx',
  'website-v2/docs/releases/v2-150-0.mdx',
  'website-v2/docs/releases/v2-152-0.mdx',
  'website-v2/docs/releases/v2-153-0.mdx',
  'website-v2/docs/releases/v2-154-0.mdx',
  'website-v2/docs/releases/v2-154-1.mdx',
  'website-v2/docs/releases/v2-154-3.mdx',
  'website-v2/docs/releases/v2-154-5.mdx',
  'website-v2/docs/releases/v2-154-7.mdx',
];
const DOC_PATHS = [CHECKLIST_PATH, RUNBOOK_PATH];

function readRepoFile(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

function fileExists(relPath) {
  try {
    readFileSync(join(REPO_ROOT, relPath), 'utf8');
    return true;
  } catch {
    return false;
  }
}

describe('BUG-59 / BUG-54 tester quote-back docs', () => {
  it('matches the current public command surface', () => {
    const bin = readRepoFile('cli/bin/agentxchain.js');
    assert.match(bin, /\.command\('run'\)/);
    assert.match(bin, /\.command\('step'\)/);
    assert.doesNotMatch(bin, /\.command\('dispatch-turn'\)/);
  });

  it('does not tell testers to run a non-existent dispatch-turn command', () => {
    for (const relPath of DOC_PATHS) {
      const doc = readRepoFile(relPath);
      assert.doesNotMatch(
        doc,
        /agentxchain\s+dispatch-turn/,
        `${relPath} must only reference public adapter-invoking commands`,
      );
    }
  });

  it('names public adapter-path commands for no-derivable-work BUG-54 diagnostics', () => {
    const runbook = readRepoFile(RUNBOOK_PATH);
    assert.match(runbook, /agentxchain run/);
    assert.match(runbook, /agentxchain step --role <role>/);
    assert.match(runbook, /agentxchain step --resume/);
  });

  it('treats decision-ledger.jsonl as JSONL, not a JSON array', () => {
    const checklist = readRepoFile(CHECKLIST_PATH);
    assert.doesNotMatch(
      checklist,
      /jq\s+'\.?\[0\]\.timestamp'/,
      'decision-ledger.jsonl freshness examples must not use JSON-array indexing',
    );
    assert.match(
      checklist,
      /jq -r 'select\(\.type == "approval_policy"\) \| \.timestamp' \.agentxchain\/decision-ledger\.jsonl \| head -n 1/,
      'checklist must provide a JSONL-safe approval_policy timestamp command',
    );
  });

  it('lives at the unversioned canonical path (legacy versioned filename absent)', () => {
    // Turn 209: BUG_59_54_2151_TESTER_QUOTEBACK_RUNBOOK.md was renamed to drop the
    // version suffix so a BUG-59 minimum-version change does not silently rot the
    // canonical runbook path. Same correction pattern as BUG-52 Turn 207.
    assert.equal(
      fileExists(LEGACY_RUNBOOK_PATH),
      false,
      `Legacy versioned runbook ${LEGACY_RUNBOOK_PATH} must not reappear — use the unversioned ${RUNBOOK_PATH}`,
    );
    assert.equal(
      fileExists(RUNBOOK_PATH),
      true,
      `Canonical runbook ${RUNBOOK_PATH} must exist`,
    );
  });

  it('recommends 2.154.7 (BUG-52-safe target) and names the version matrix', () => {
    const runbook = readRepoFile(RUNBOOK_PATH);
    assert.match(
      runbook,
      /agentxchain@2\.154\.7/,
      'runbook must pin the recommended 2.154.7 target',
    );
    assert.match(
      runbook,
      /BUG-52 third-variant/i,
      'runbook must name the BUG-52 third-variant interaction that drives the 2.154.7 recommendation',
    );
    assert.match(
      runbook,
      /\|\s*`?2\.151\.0`?\s*\|/,
      'runbook must include the version-matrix row for 2.151.0 so testers can tell which older patches still loop on BUG-52',
    );
    assert.match(
      runbook,
      /\|\s*`?2\.154\.7`?\+?\s*\|/,
      'runbook must include the version-matrix row for 2.154.7+',
    );
  });

  it('no longer pins commands to the stale 2.151.0 npx target', () => {
    const runbook = readRepoFile(RUNBOOK_PATH);
    assert.doesNotMatch(
      runbook,
      /npx\s+--yes\s+-p\s+agentxchain@2\.151\.0/,
      'runbook must not pin command lines to 2.151.0; use 2.154.7 so testers do not hit the BUG-52 third-variant loop',
    );
    assert.doesNotMatch(
      runbook,
      /npx\s+--yes\s+-p\s+agentxchain@2\.15[0-3]\.0/,
      'runbook must not pin command lines to 2.150.x / 2.151.x / 2.152.x / 2.153.x — none of those carry the full BUG-52 third-variant fix',
    );
  });

  it('checklist retargets package-proof commands to 2.154.7', () => {
    const checklist = readRepoFile(CHECKLIST_PATH);
    assert.match(
      checklist,
      /npx\s+--yes\s+-p\s+agentxchain@2\.154\.7/,
      'checklist must pin package-proof verification to 2.154.7',
    );
    assert.match(
      checklist,
      /npm\s+view\s+agentxchain@2\.154\.7\s+version/,
      'agent cross-check must verify 2.154.7 is published',
    );
    assert.match(
      checklist,
      new RegExp(RUNBOOK_PATH.replace(/\./g, '\\.').replace(/\//g, '\\/')),
      'checklist must link to the canonical unversioned runbook path',
    );
  });

  it('public v2.151.0 release page points current BUG-59/54 quote-back to 2.154.7', () => {
    const releasePage = readRepoFile(RELEASE_151_PATH);
    assert.match(
      releasePage,
      /Current quote-back target:[\s\S]*agentxchain@2\.154\.7/,
      'v2.151.0 public release notes must warn that current BUG-59/54 quote-back uses the BUG-52-safe 2.154.7 target',
    );
    assert.match(
      releasePage,
      /BUG_59_54_TESTER_QUOTEBACK_RUNBOOK\.md/,
      'v2.151.0 release notes must link operators to the canonical BUG-59/54 runbook',
    );
    assert.match(
      releasePage,
      /npx\s+--yes\s+-p\s+agentxchain@2\.154\.7\s+-c "agentxchain --version"/,
      'v2.151.0 tester contract command must use the current 2.154.7 target',
    );
    assert.doesNotMatch(
      releasePage,
      /npx\s+--yes\s+-p\s+agentxchain@2\.151\.0\s+-c "agentxchain --version"/,
      'v2.151.0 release notes may mention the historical version, but must not keep a live npx command pinned to it',
    );
    assert.match(
      releasePage,
      /default 180,000 ms threshold/,
      'BUG-54 public quote-back wording must match the current 180,000 ms default',
    );
    assert.doesNotMatch(
      releasePage,
      /startup watchdog default raised to 120,000 ms/,
      'v2.151.0 release notes must not preserve the stale 120,000 ms BUG-54 default',
    );
    assert.doesNotMatch(
      releasePage,
      /startup watchdog default\*\* raised from 30s to 120s/,
      'v2.151.0 intro must not preserve the stale 120s BUG-54 summary',
    );
  });

  it('public still-open BUG-54/59 closure footers point to the BUG-52-safe runbook target', () => {
    for (const relPath of RELEASE_PAGES_WITH_BUG_54_59_FOOTERS) {
      const releasePage = readRepoFile(relPath);
      assert.match(
        releasePage,
        /agentxchain@2\.154\.7[\s\S]{0,180}BUG_59_54_TESTER_QUOTEBACK_RUNBOOK\.md|BUG_59_54_TESTER_QUOTEBACK_RUNBOOK\.md[\s\S]{0,180}agentxchain@2\.154\.7/,
        `${relPath} must route BUG-54/BUG-59 quote-back through the 2.154.7 BUG-52-safe runbook`,
      );
      assert.match(
        releasePage,
        /routine auto-approval ledger[\s\S]{0,80}credentialed hard-stop counter-evidence|credentialed hard-stop counter-evidence[\s\S]{0,80}routine auto-approval ledger/,
        `${relPath} must preserve the BUG-59 positive and credentialed-negative evidence shape`,
      );
    }
  });

  it('short tester ask preserves BUG-59/BUG-54 rejection boundaries', () => {
    const ask = readRepoFile(TESTER_ASK_V2_PATH);
    assert.match(
      ask,
      /Companion ask for BUG-52 lives at `\.planning\/TESTER_QUOTEBACK_ASK_V1\.md`/,
      'V2 ask must cross-link the separate BUG-52 quote-back ask',
    );
    assert.match(
      ask,
      /Target package:[\s\S]{0,80}`agentxchain@2\.154\.7`/,
      'V2 ask must keep the BUG-52-safe package target visible in the copy-paste message',
    );
    assert.match(
      ask,
      /matched_rule\.when\.credentialed_gate: false` or an equivalent generated non-credentialed guard/,
      'V2 ask must accept either the explicit credentialed_gate:false field or an equivalent generated non-credentialed guard',
    );
    assert.match(
      ask,
      /do not show `matched_rule\.when\.credentialed_gate: false` or an equivalent generated non-credentialed guard/,
      'V2 ask must reject missing non-credentialed guard evidence, not only credentialed_gate:true evidence',
    );
    assert.match(
      ask,
      /10 KB on the fallback path/,
      'BUG-54 fallback evidence must preserve the runbook minimum realistic bundle size',
    );
    assert.match(
      ask,
      /evidence comes only from the standalone repro harness with no adapter-path attempts at all/,
      'BUG-54 closure must still require adapter-path attempts, not harness-only timing proof',
    );
  });

  it('V2 BUG-54 block 5 inlines the primary dogfood run, current-window diagnostics, and fallback harness commands', () => {
    // Turn 223: V2's BUG-54 block previously said "fall back to the repro harness
    // extracted from the registry tarball per the runbook" without inlining the
    // commands, forcing the tester to flip between V2 and the runbook. Block 5 now
    // inlines the primary run, current-window event/log extraction, and the fallback
    // harness extraction. These guards prevent silent regression back to "see the
    // runbook" wording or broad historical grep for BUG-54 evidence.
    const ask = readRepoFile(TESTER_ASK_V2_PATH);
    assert.match(
      ask,
      /npx\s+--yes\s+-p\s+agentxchain@2\.154\.7\s+-c\s+'agentxchain\s+run\s+--continuous[\s\S]{0,220}--max-runs\s+10/,
      'V2 BUG-54 block must inline the primary dogfood run command pinned to 2.154.7 with --max-runs 10',
    );
    assert.match(
      ask,
      /export\s+BUG54_START_TS="\$\(date\s+-u\s+\+"%Y-%m-%dT%H:%M:%SZ"\)"/,
      'V2 BUG-54 block must capture a current-run timestamp before the dogfood run',
    );
    assert.match(
      ask,
      /agentxchain\s+events\s+--since\s+\\?"\$BUG54_START_TS\\?"\s+--type\s+turn_dispatched,turn_start_failed,runtime_spawn_failed,stdout_attach_failed,run_blocked\s+--json\s+--limit\s+0/,
      'V2 BUG-54 block must scope event evidence to the current timestamp window',
    );
    assert.match(
      ask,
      /node\s+<<'BUG54_DIAG'[\s\S]{0,1600}Current-window turn ids:[\s\S]{0,900}\.agentxchain[\s\S]{0,80}dispatch[\s\S]{0,80}turns[\s\S]{0,80}stdout\.log/,
      'V2 BUG-54 block must inline the current-window dispatch-log extractor',
    );
    assert.doesNotMatch(
      ask,
      /grep\s+-RInE\s+'spawn_attached\|first_output\|startup_watchdog_fired\|stdout_attach_failed\|ghost_turn'\s+\.agentxchain\s+2>\/dev\/null\s+\|\|\s+true/,
      'V2 BUG-54 block must not use a repo-wide .agentxchain grep that can pick up historical failures',
    );
    assert.match(
      ask,
      /curl\s+-fsSL\s+https:\/\/registry\.npmjs\.org\/agentxchain\/-\/agentxchain-2\.154\.7\.tgz/,
      'V2 BUG-54 fallback must inline the runbook tarball URL pinned to 2.154.7',
    );
    assert.match(
      ask,
      /npm\s+pack\s+agentxchain@2\.154\.7\s+--pack-destination/,
      'V2 BUG-54 fallback must inline the npm pack retry pinned to 2.154.7',
    );
    assert.match(
      ask,
      /node\s+"\$REPRO_DIR\/package\/scripts\/reproduce-bug-54\.mjs"\s+\\?\s*\n?\s*--attempts\s+10\s+--watchdog-ms\s+180000\s+--out\s+\/tmp\/bug54-latest\.json/,
      'V2 BUG-54 fallback must inline the harness invocation with --attempts 10 --watchdog-ms 180000',
    );
    assert.match(
      ask,
      /jq\s+'\.attempts\[\][\s\S]{0,240}first_stdout_elapsed_ms[\s\S]{0,120}watchdog_fired/,
      'V2 BUG-54 fallback must inline the per-attempt jq extraction (first_stdout_elapsed_ms + watchdog_fired)',
    );
    // Turn 227: BUG-54 fallback jq keys MUST match the real harness schema
    // (attempt_index, first_stdout_elapsed_ms, first_stderr_elapsed_ms,
    // stdout_bytes, stderr_bytes). The earlier key set (attempt,
    // first_stdout_ms, stdout_bytes_total, ...) produced all-null rows when
    // run against the 2.154.7 tarball output — a real tester would have
    // concluded there was no evidence. Guard against regression.
    assert.match(
      ask,
      /jq\s+'\.attempts\[\][\s\S]{0,320}attempt_index[\s\S]{0,120}first_stdout_elapsed_ms[\s\S]{0,120}first_stderr_elapsed_ms[\s\S]{0,120}watchdog_fired[\s\S]{0,120}exit_signal[\s\S]{0,120}stdout_bytes[\s\S]{0,80}stderr_bytes/,
      'V2 BUG-54 fallback jq must use the real reproduce-bug-54.mjs attempt schema keys',
    );
    assert.doesNotMatch(
      ask,
      /\{attempt, classification, first_stdout_ms/,
      'V2 BUG-54 fallback must not regress to the broken jq keys (attempt/first_stdout_ms/etc.)',
    );
    assert.doesNotMatch(
      ask,
      /stdout_bytes_total|stderr_bytes_total/,
      'V2 BUG-54 fallback must not use non-existent stdout_bytes_total/stderr_bytes_total keys',
    );
    assert.match(
      ask,
      /Paste both fallback `jq` outputs together[\s\S]{0,220}runtime id \/ command probe[\s\S]{0,220}ten per-attempt timing rows/,
      'V2 BUG-54 fallback must explicitly require both jq outputs so runtime identity and timing rows are quoted together',
    );
    assert.doesNotMatch(
      ask,
      /fall back to the repro harness extracted from the registry tarball per the runbook/,
      'V2 BUG-54 block must not regress to the "per the runbook" fallback stub',
    );
  });

  it('V2 BUG-54 inlined commands match the runbook exact shape (no silent drift)', () => {
    // Turn 223: inlining creates drift risk. Fail loud if V2 inlines the harness
    // tarball URL, the curl/tar fallback pattern, the reproduce-bug-54.mjs flags,
    // or the per-attempt jq field list differently from the canonical runbook.
    const ask = readRepoFile(TESTER_ASK_V2_PATH);
    const runbook = readRepoFile(RUNBOOK_PATH);
    const SHARED_SHAPES = [
      /curl\s+-fsSL\s+https:\/\/registry\.npmjs\.org\/agentxchain\/-\/agentxchain-2\.154\.7\.tgz/,
      /npm\s+pack\s+agentxchain@2\.154\.7\s+--pack-destination\s+"\$REPRO_DIR"/,
      /node\s+"\$REPRO_DIR\/package\/scripts\/reproduce-bug-54\.mjs"/,
      /--attempts\s+10\s+--watchdog-ms\s+180000\s+--out\s+\/tmp\/bug54-latest\.json/,
      /export\s+BUG54_START_TS="\$\(date\s+-u\s+\+"%Y-%m-%dT%H:%M:%SZ"\)"/,
      /agentxchain\s+events\s+--since\s+\\?"\$BUG54_START_TS\\?"\s+--type\s+turn_dispatched,turn_start_failed,runtime_spawn_failed,stdout_attach_failed,run_blocked\s+--json\s+--limit\s+0/,
      /node\s+<<'BUG54_DIAG'[\s\S]{0,2400}Current-window turn ids:[\s\S]{0,1800}\.agentxchain[\s\S]{0,120}dispatch[\s\S]{0,120}turns[\s\S]{0,120}stdout\.log/,
      // Turn 227: the per-attempt jq field list MUST use the real
      // reproduce-bug-54.mjs attempt schema keys (attempt_index,
      // first_stdout_elapsed_ms, first_stderr_elapsed_ms, stdout_bytes,
      // stderr_bytes). The earlier key set (attempt, first_stdout_ms,
      // stdout_bytes_total, stderr_bytes_total) produced all-null rows when
      // piped through the 2.154.7 tarball output — a tester following the
      // recipe verbatim would have concluded there was no per-attempt
      // evidence. Lock the shape on both surfaces.
      /jq\s+'\.attempts\[\][\s\S]{0,40}attempt_index,\s*classification,\s*first_stdout_elapsed_ms,\s*first_stderr_elapsed_ms,\s*watchdog_fired,\s*exit_signal,\s*stdout_bytes,\s*stderr_bytes\}/,
    ];
    for (const pat of SHARED_SHAPES) {
      assert.match(
        runbook,
        pat,
        `Runbook must still contain canonical shape ${pat} (V2 inlines this verbatim)`,
      );
      assert.match(
        ask,
        pat,
        `V2 ask must still inline canonical shape ${pat} (matches the runbook)`,
      );
    }
    // Turn 227: negative guard — neither surface may regress to the broken
    // jq key set that produced all-null rows against the real harness output.
    const BROKEN_JQ_PATTERNS = [
      /\{attempt, classification, first_stdout_ms/,
      /stdout_bytes_total/,
      /stderr_bytes_total/,
    ];
    for (const bad of BROKEN_JQ_PATTERNS) {
      assert.doesNotMatch(
        runbook,
        bad,
        `Runbook must not regress to the broken jq key set (${bad})`,
      );
      assert.doesNotMatch(
        ask,
        bad,
        `V2 ask must not regress to the broken jq key set (${bad})`,
      );
    }
  });

  it('BUG-54 diagnostic extractor emits a SUMMARY JSON line keyed for closure review', () => {
    // Turn 223 (Claude): the per-line diagnostic output alone forces the tester
    // (and the reviewing agent) to hand-count spawn_attached, first_output,
    // startup_watchdog_fired, stdout_attach_failed, and ghost_turn lines to
    // decide whether evidence meets the 10-attempt / zero-failure closure
    // threshold. A single `BUG-54 SUMMARY: {...}` line keyed on `turns_matched`,
    // `stdout_logs_present`, `stdout_logs_missing`, `spawn_attached_lines`,
    // `first_output_lines`, `startup_watchdog_fired_lines`,
    // `stdout_attach_failed_lines`, and `ghost_turn_lines` collapses the review
    // to one JSON object. Guard both surfaces.
    const runbook = readRepoFile(RUNBOOK_PATH);
    const ask = readRepoFile(TESTER_ASK_V2_PATH);
    const SUMMARY_KEYS = [
      'turns_matched',
      'stdout_logs_present',
      'stdout_logs_missing',
      'spawn_attached_lines',
      'first_output_lines',
      'startup_watchdog_fired_lines',
      'stdout_attach_failed_lines',
      'ghost_turn_lines',
    ];
    const SUMMARY_LINE = /console\.log\(`BUG-54 SUMMARY: \$\{JSON\.stringify\(counters\)\}`\)/;
    for (const [label, body] of [['runbook', runbook], ['V2 ask', ask]]) {
      assert.match(
        body,
        SUMMARY_LINE,
        `${label} must emit a single BUG-54 SUMMARY: <json> line`,
      );
      for (const key of SUMMARY_KEYS) {
        assert.ok(
          body.includes(`${key}:`),
          `${label} counters object must declare the ${key} counter`,
        );
      }
      assert.match(
        body,
        /turns_matched >= 10/,
        `${label} must name the 10-attempt closure threshold against turns_matched`,
      );
      assert.match(
        body,
        /stdout_logs_missing[\s\S]{0,40}0[\s\S]{0,140}startup_watchdog_fired_lines[\s\S]{0,40}0[\s\S]{0,140}stdout_attach_failed_lines[\s\S]{0,40}0[\s\S]{0,140}ghost_turn_lines[\s\S]{0,40}0/,
        `${label} must require missing stdout logs plus all three failure counters to be zero for closure`,
      );
    }
  });
});
