import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const SPEC_PATH = join(ROOT, '.planning', 'LIVE_CONTINUOUS_MIXED_RUNTIME_PROOF_SPEC.md');
const SCRIPT_PATH = join(ROOT, 'examples', 'live-governed-proof', 'run-continuous-mixed-proof.mjs');
const DOC_PATH = join(ROOT, 'website-v2', 'docs', 'lights-out-operation.mdx');

const SPEC = readFileSync(SPEC_PATH, 'utf8');
const SCRIPT = readFileSync(SCRIPT_PATH, 'utf8');
const DOC = readFileSync(DOC_PATH, 'utf8');

describe('live continuous mixed-runtime proof contract', () => {
  it('AT-LIVE-CONT-001: ships the spec and proof script', () => {
    assert.ok(existsSync(SPEC_PATH), 'live continuous mixed-runtime proof spec must exist');
    assert.ok(existsSync(SCRIPT_PATH), 'live continuous mixed-runtime proof script must exist');
  });

  it('AT-LIVE-CONT-002: script shells out to the real CLI continuous surface', () => {
    assert.match(SCRIPT, /binPath = join\(cliRoot, 'bin', 'agentxchain\.js'\)/);
    assert.match(SCRIPT, /spawnSync\(/);
    assert.match(SCRIPT, /'run'/);
    assert.match(SCRIPT, /'--continuous'/);
    assert.match(SCRIPT, /'--vision', '\.planning\/VISION\.md'/);
    assert.match(SCRIPT, /'--max-runs', '1'/);
  });

  it('AT-LIVE-CONT-003: script encodes the truthful mixed-runtime boundary', () => {
    assert.match(SCRIPT, /committing-proof-agent\.mjs/);
    assert.match(SCRIPT, /review_only/);
    assert.match(SCRIPT, /api_proxy/);
    assert.match(SCRIPT, /review_only api_proxy roles can author repo-local gate files/i);
    assert.match(SCRIPT, /\.agentxchain\/continuous-session\.json/);
    assert.match(SCRIPT, /\.agentxchain\/run-history\.jsonl/);
    assert.match(SCRIPT, /\.agentxchain\/reviews/);
    assert.match(SPEC, /commits each authored slice/i);
    assert.match(SPEC, /clean baseline between the next authoritative turn is assigned|clean baseline before the next authoritative turn is assigned/i);
  });

  it('AT-LIVE-CONT-004: script skips cleanly without ANTHROPIC_API_KEY', () => {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;

    const result = spawnSync(process.execPath, [SCRIPT_PATH, '--json'], {
      cwd: ROOT,
      env,
      encoding: 'utf8',
      timeout: 10_000,
    });

    assert.equal(result.status, 0, `expected skip exit 0, got ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.result, 'skip');
    assert.match(parsed.reason, /ANTHROPIC_API_KEY/);
  });

  it('AT-LIVE-CONT-005: docs and spec name the mixed-runtime proof shape explicitly', () => {
    assert.match(SPEC, /`review_only` `api_proxy` roles still cannot author repo files/i);
    assert.match(SPEC, /run-continuous-mixed-proof\.mjs/);
    assert.match(DOC, /run-continuous-mixed-proof\.mjs/);
    assert.match(DOC, /A `review_only` `api_proxy` QA role can validate and request completion, but it cannot create gate files/i);
  });
});
