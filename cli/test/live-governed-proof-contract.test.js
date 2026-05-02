import { describe, it } from 'vitest';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const PROOF_SCRIPT = join(REPO_ROOT, 'examples', 'live-governed-proof', 'run-live-turn.mjs');

describe('live-governed-proof contract', () => {
  describe('boundary rules', () => {
    const source = readFileSync(PROOF_SCRIPT, 'utf8');

    it('imports from runner-interface.js', () => {
      assert.ok(
        source.includes('runner-interface.js'),
        'Must import from runner-interface.js',
      );
    });

    it('imports from api-proxy-adapter.js', () => {
      assert.ok(
        source.includes('api-proxy-adapter.js'),
        'Must import from api-proxy-adapter.js (the declared adapter interface)',
      );
    });

    it('does not import governed-state.js directly', () => {
      assert.ok(
        !source.includes("from './governed-state") &&
          !source.includes("from '../governed-state") &&
          !source.includes('/governed-state.js'),
        'Must not import governed-state.js directly',
      );
    });

    it('does not import turn-paths.js directly', () => {
      // The script should use getTurnStagingResultPath from runner-interface.js
      const lines = source.split('\n');
      const importLines = lines.filter(
        (l) => l.includes('import') && l.includes('turn-paths'),
      );
      assert.strictEqual(
        importLines.length,
        0,
        'Must not import turn-paths.js directly — use runner-interface.js exports',
      );
    });

    it('does not import dispatch-bundle.js directly', () => {
      const lines = source.split('\n');
      const importLines = lines.filter(
        (l) => l.includes('import') && l.includes('dispatch-bundle'),
      );
      assert.strictEqual(
        importLines.length,
        0,
        'Must not import dispatch-bundle.js directly — use runner-interface.js exports',
      );
    });

    it('does not shell out to CLI binary', () => {
      assert.ok(
        !source.includes('child_process') && !source.includes('spawnSync') && !source.includes('execSync'),
        'Must not shell out to CLI binary',
      );
    });

    it('uses a cheap model for cost control', () => {
      assert.ok(
        source.includes('claude-haiku-4-5-20251001') || source.includes('gpt-4o-mini'),
        'Must use a cheap model to minimize proof cost',
      );
    });
  });

  describe('skip behavior (no credentials)', () => {
    it('exits 0 with skip result when no API key is set', () => {
      // Run the script with no API keys in env
      const env = { ...process.env };
      delete env.ANTHROPIC_API_KEY;
      delete env.OPENAI_API_KEY;

      const result = spawnSync(process.execPath, [PROOF_SCRIPT, '--json'], {
        cwd: REPO_ROOT,
        env,
        timeout: 10_000,
      });

      assert.strictEqual(result.status, 0, 'Should exit 0 when credentials are missing');

      const output = result.stdout.toString().trim();
      const parsed = JSON.parse(output);
      assert.strictEqual(parsed.result, 'skip', 'Should report result: skip');
      assert.ok(parsed.reason, 'Should include a skip reason');
    });
  });

  describe('spec alignment', () => {
    const specPath = join(REPO_ROOT, '.planning', 'LIVE_GOVERNED_API_PROXY_EXAMPLE_SPEC.md');
    const spec = readFileSync(specPath, 'utf8');
    const source = readFileSync(PROOF_SCRIPT, 'utf8');

    it('spec exists', () => {
      assert.ok(spec.includes('Live Governed API Proxy Example'), 'Spec title should match');
    });

    it('script validates all artifacts listed in spec', () => {
      // Spec requires: state.json, history.jsonl, decision-ledger.jsonl, PROMPT.md, CONTEXT.md, ASSIGNMENT.json, API_REQUEST.json, turn-result.json
      const requiredArtifacts = [
        'state.json',
        'history.jsonl',
        'decision-ledger.jsonl',
        'PROMPT.md',
        'CONTEXT.md',
        'ASSIGNMENT.json',
        'API_REQUEST.json',
        'turn-result.json',
      ];
      for (const artifact of requiredArtifacts) {
        assert.ok(
          source.includes(artifact),
          `Script must validate artifact: ${artifact}`,
        );
      }
    });

    it('documents and implements two-phase validation around acceptTurn cleanup', () => {
      assert.match(
        spec,
        /Validate pre-acceptance artifacts\./,
        'spec must describe pre-acceptance validation',
      );
      assert.match(
        spec,
        /acceptTurn cleans up both dirs after commit/,
        'spec must document cleanup timing explicitly',
      );
      assert.match(
        spec,
        /dispatch and staging directories are removed while `state\.json`, `history\.jsonl`, and `decision-ledger\.jsonl` remain valid/,
        'spec must describe post-acceptance cleanup truthfully',
      );
      assert.match(source, /validatePreAcceptanceArtifacts/, 'script must validate artifacts before acceptance');
      assert.match(source, /validatePostAcceptanceArtifacts/, 'script must validate retained artifacts after acceptance');
      assert.match(
        source,
        /acceptTurn cleans up both dirs after commit/,
        'script must encode the cleanup reason for two-phase validation',
      );
    });
  });
});
