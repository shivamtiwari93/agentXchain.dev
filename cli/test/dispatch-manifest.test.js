/**
 * Dispatch manifest integrity tests — V2.1-F1
 *
 * Tests the content-addressed dispatch bundle manifest system:
 *   - finalizeDispatchManifest: scans bundle, writes MANIFEST.json
 *   - verifyDispatchManifest: verifies bundle against manifest
 *   - Acceptance tests: AT-V21-001 through AT-V21-003, AT-V21-MANIFEST-001 through 003
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { tmpdir } from 'os';

import { finalizeDispatchManifest, verifyDispatchManifest } from '../src/lib/dispatch-manifest.js';
import { getDispatchTurnDir, getDispatchManifestPath } from '../src/lib/turn-paths.js';

function createTmpRoot() {
  const root = join(tmpdir(), `agentxchain-manifest-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function writeBundleFiles(root, turnId, files = {}) {
  const bundleDir = join(root, getDispatchTurnDir(turnId));
  mkdirSync(bundleDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(bundleDir, name), content);
  }
  return bundleDir;
}

describe('dispatch-manifest', () => {
  let root;
  const turnId = 'turn-manifest-test-001';
  const identity = { run_id: 'run-test-001', role: 'dev' };

  beforeEach(() => {
    root = createTmpRoot();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('finalizeDispatchManifest', () => {
    it('writes MANIFEST.json with correct entries for all bundle files', () => {
      const assignmentContent = JSON.stringify({ run_id: 'run-test-001', turn_id: turnId });
      const promptContent = '# Turn Assignment: Dev\n\nDo the work.\n';
      const contextContent = '# Execution Context\n\nCurrent state...\n';

      writeBundleFiles(root, turnId, {
        'ASSIGNMENT.json': assignmentContent,
        'PROMPT.md': promptContent,
        'CONTEXT.md': contextContent,
      });

      const result = finalizeDispatchManifest(root, turnId, identity);
      assert.ok(result.ok, `Expected ok, got: ${result.error}`);
      assert.equal(result.fileCount, 3);

      const manifest = JSON.parse(readFileSync(join(root, getDispatchManifestPath(turnId)), 'utf8'));
      assert.equal(manifest.manifest_version, '1.0');
      assert.equal(manifest.run_id, 'run-test-001');
      assert.equal(manifest.turn_id, turnId);
      assert.equal(manifest.role, 'dev');
      assert.ok(manifest.finalized_at);
      assert.equal(manifest.files.length, 3);

      const paths = manifest.files.map((f) => f.path).sort();
      assert.deepEqual(paths, ['ASSIGNMENT.json', 'CONTEXT.md', 'PROMPT.md']);

      // Verify digests
      for (const entry of manifest.files) {
        const content = readFileSync(join(root, getDispatchTurnDir(turnId), entry.path));
        assert.equal(entry.sha256, sha256(content), `Digest mismatch for ${entry.path}`);
        assert.equal(entry.size, content.length, `Size mismatch for ${entry.path}`);
      }
    });

    it('returns error when bundle directory does not exist', () => {
      const result = finalizeDispatchManifest(root, 'nonexistent-turn', identity);
      assert.equal(result.ok, false);
      assert.match(result.error, /does not exist/);
    });

    it('returns error when bundle directory is empty', () => {
      const bundleDir = join(root, getDispatchTurnDir(turnId));
      mkdirSync(bundleDir, { recursive: true });

      const result = finalizeDispatchManifest(root, turnId, identity);
      assert.equal(result.ok, false);
      assert.match(result.error, /empty/);
    });

    it('is idempotent — re-finalization overwrites previous manifest', () => {
      writeBundleFiles(root, turnId, { 'PROMPT.md': 'v1' });
      const r1 = finalizeDispatchManifest(root, turnId, identity);
      assert.ok(r1.ok);

      // Change a file and re-finalize
      writeFileSync(join(root, getDispatchTurnDir(turnId), 'PROMPT.md'), 'v2');
      const r2 = finalizeDispatchManifest(root, turnId, identity);
      assert.ok(r2.ok);

      const manifest = JSON.parse(readFileSync(join(root, getDispatchManifestPath(turnId)), 'utf8'));
      const promptEntry = manifest.files.find((f) => f.path === 'PROMPT.md');
      assert.equal(promptEntry.sha256, sha256(Buffer.from('v2')));
    });

    it('excludes MANIFEST.json from its own entries', () => {
      writeBundleFiles(root, turnId, { 'PROMPT.md': 'test' });

      // Write a fake MANIFEST.json first
      writeFileSync(join(root, getDispatchTurnDir(turnId), 'MANIFEST.json'), '{}');

      const result = finalizeDispatchManifest(root, turnId, identity);
      assert.ok(result.ok);
      assert.equal(result.fileCount, 1); // Only PROMPT.md, not MANIFEST.json

      const manifest = JSON.parse(readFileSync(join(root, getDispatchManifestPath(turnId)), 'utf8'));
      const selfEntry = manifest.files.find((f) => f.path === 'MANIFEST.json');
      assert.equal(selfEntry, undefined, 'MANIFEST.json should not be in its own entries');
    });
  });

  describe('verifyDispatchManifest', () => {
    it('passes verification for a correctly finalized bundle', () => {
      writeBundleFiles(root, turnId, {
        'ASSIGNMENT.json': '{"run_id":"test"}',
        'PROMPT.md': '# Prompt',
        'CONTEXT.md': '# Context',
      });
      finalizeDispatchManifest(root, turnId, identity);

      const result = verifyDispatchManifest(root, turnId);
      assert.ok(result.ok, `Expected ok, got errors: ${JSON.stringify(result.errors)}`);
      assert.ok(result.manifest);
    });

    it('fails on missing manifest', () => {
      writeBundleFiles(root, turnId, { 'PROMPT.md': 'test' });
      // No finalization

      const result = verifyDispatchManifest(root, turnId);
      assert.equal(result.ok, false);
      assert.equal(result.errors[0].type, 'missing_manifest');
    });

    it('fails on malformed manifest', () => {
      writeBundleFiles(root, turnId, { 'PROMPT.md': 'test' });
      writeFileSync(join(root, getDispatchManifestPath(turnId)), 'not json!!!');

      const result = verifyDispatchManifest(root, turnId);
      assert.equal(result.ok, false);
      assert.equal(result.errors[0].type, 'invalid_manifest');
    });

    it('fails on invalid manifest schema', () => {
      writeBundleFiles(root, turnId, { 'PROMPT.md': 'test' });
      writeFileSync(join(root, getDispatchManifestPath(turnId)), JSON.stringify({ foo: 'bar' }));

      const result = verifyDispatchManifest(root, turnId);
      assert.equal(result.ok, false);
      assert.equal(result.errors[0].type, 'invalid_manifest');
    });
  });

  // ── Acceptance Tests ─────────────────────────────────────────────────────

  describe('AT-V21-001: unexpected file rejected', () => {
    it('detects a file injected after manifest finalization', () => {
      writeBundleFiles(root, turnId, {
        'ASSIGNMENT.json': '{"run_id":"test"}',
        'PROMPT.md': '# Prompt',
        'CONTEXT.md': '# Context',
      });
      finalizeDispatchManifest(root, turnId, identity);

      // Inject an unexpected file after finalization
      writeFileSync(join(root, getDispatchTurnDir(turnId), 'INJECTED.txt'), 'malicious payload');

      const result = verifyDispatchManifest(root, turnId);
      assert.equal(result.ok, false);
      const unexpectedError = result.errors.find((e) => e.type === 'unexpected_file');
      assert.ok(unexpectedError, 'Should have unexpected_file error');
      assert.equal(unexpectedError.path, 'INJECTED.txt');
    });
  });

  describe('AT-V21-002: digest mismatch rejected', () => {
    it('detects modified file contents after finalization', () => {
      writeBundleFiles(root, turnId, {
        'ASSIGNMENT.json': '{"run_id":"test"}',
        'PROMPT.md': '# Original prompt content',
        'CONTEXT.md': '# Context',
      });
      finalizeDispatchManifest(root, turnId, identity);

      // Tamper with PROMPT.md after finalization
      writeFileSync(join(root, getDispatchTurnDir(turnId), 'PROMPT.md'), '# TAMPERED prompt content');

      const result = verifyDispatchManifest(root, turnId);
      assert.equal(result.ok, false);
      const digestError = result.errors.find((e) => e.type === 'digest_mismatch');
      assert.ok(digestError, 'Should have digest_mismatch error');
      assert.equal(digestError.path, 'PROMPT.md');
    });
  });

  describe('AT-V21-003: after_dispatch supplements included in manifest', () => {
    it('captures supplement files added before finalization', () => {
      writeBundleFiles(root, turnId, {
        'ASSIGNMENT.json': '{"run_id":"test"}',
        'PROMPT.md': '# Prompt',
        'CONTEXT.md': '# Context',
      });

      // Simulate after_dispatch hook adding a supplement
      writeFileSync(
        join(root, getDispatchTurnDir(turnId), 'hook_supplement_compliance.json'),
        '{"policy":"approved"}'
      );

      // Finalize AFTER supplement is written (correct timing)
      const result = finalizeDispatchManifest(root, turnId, identity);
      assert.ok(result.ok);
      assert.equal(result.fileCount, 4); // 3 core + 1 supplement

      // Verify the supplement is in the manifest
      const manifest = JSON.parse(readFileSync(join(root, getDispatchManifestPath(turnId)), 'utf8'));
      const supplementEntry = manifest.files.find((f) => f.path === 'hook_supplement_compliance.json');
      assert.ok(supplementEntry, 'Supplement should be in manifest');

      // Verification should pass
      const verifyResult = verifyDispatchManifest(root, turnId);
      assert.ok(verifyResult.ok, `Verification should pass: ${JSON.stringify(verifyResult.errors)}`);
    });
  });

  describe('AT-V21-MANIFEST-001: core files captured', () => {
    it('manifest contains ASSIGNMENT.json, PROMPT.md, CONTEXT.md with valid digests', () => {
      const files = {
        'ASSIGNMENT.json': JSON.stringify({ run_id: 'run-001', turn_id: turnId }, null, 2),
        'PROMPT.md': '# Turn Assignment: Dev\n\nYour mandate...\n',
        'CONTEXT.md': '# Execution Context\n\nCurrent state...\n',
      };
      writeBundleFiles(root, turnId, files);
      finalizeDispatchManifest(root, turnId, identity);

      const manifest = JSON.parse(readFileSync(join(root, getDispatchManifestPath(turnId)), 'utf8'));

      for (const [name, content] of Object.entries(files)) {
        const entry = manifest.files.find((f) => f.path === name);
        assert.ok(entry, `${name} should be in manifest`);
        assert.equal(entry.sha256, sha256(Buffer.from(content)), `${name} digest should match`);
        assert.equal(entry.size, Buffer.from(content).length, `${name} size should match`);
      }
    });
  });

  describe('AT-V21-MANIFEST-002: missing file detected', () => {
    it('verification fails when a declared file is deleted', () => {
      writeBundleFiles(root, turnId, {
        'ASSIGNMENT.json': '{}',
        'PROMPT.md': '# Prompt',
        'CONTEXT.md': '# Context',
      });
      finalizeDispatchManifest(root, turnId, identity);

      // Delete CONTEXT.md
      unlinkSync(join(root, getDispatchTurnDir(turnId), 'CONTEXT.md'));

      const result = verifyDispatchManifest(root, turnId);
      assert.equal(result.ok, false);
      const missingError = result.errors.find((e) => e.type === 'missing_file');
      assert.ok(missingError, 'Should have missing_file error');
      assert.equal(missingError.path, 'CONTEXT.md');
    });
  });

  describe('AT-V21-MANIFEST-003: coordinator context in manifest', () => {
    it('COORDINATOR_CONTEXT.json is captured in manifest for multi-repo bundles', () => {
      writeBundleFiles(root, turnId, {
        'ASSIGNMENT.json': '{}',
        'PROMPT.md': '# Prompt',
        'CONTEXT.md': '# Context',
        'COORDINATOR_CONTEXT.json': JSON.stringify({ upstream_acceptances: [] }),
        'COORDINATOR_CONTEXT.md': '# Coordinator Context\n\nUpstream...',
      });
      finalizeDispatchManifest(root, turnId, identity);

      const manifest = JSON.parse(readFileSync(join(root, getDispatchManifestPath(turnId)), 'utf8'));
      assert.equal(manifest.files.length, 5);

      const coordJson = manifest.files.find((f) => f.path === 'COORDINATOR_CONTEXT.json');
      const coordMd = manifest.files.find((f) => f.path === 'COORDINATOR_CONTEXT.md');
      assert.ok(coordJson, 'COORDINATOR_CONTEXT.json should be in manifest');
      assert.ok(coordMd, 'COORDINATOR_CONTEXT.md should be in manifest');
    });
  });

  describe('size mismatch detection', () => {
    it('detects size mismatch even when digest also mismatches', () => {
      writeBundleFiles(root, turnId, { 'PROMPT.md': 'short' });
      finalizeDispatchManifest(root, turnId, identity);

      // Replace with much longer content
      writeFileSync(join(root, getDispatchTurnDir(turnId), 'PROMPT.md'), 'a'.repeat(1000));

      const result = verifyDispatchManifest(root, turnId);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => e.type === 'size_mismatch'));
      assert.ok(result.errors.some((e) => e.type === 'digest_mismatch'));
    });
  });

  describe('adapter verification integration', () => {
    it('verifyManifest option causes local-cli adapter to fail on tampered bundle', async () => {
      // This test verifies the adapter-level integration contract:
      // when verifyManifest is true and the manifest is invalid, the adapter rejects

      const { dispatchLocalCli } = await import('../src/lib/adapters/local-cli-adapter.js');

      writeBundleFiles(root, turnId, {
        'ASSIGNMENT.json': '{}',
        'PROMPT.md': '# Prompt',
        'CONTEXT.md': '# Context',
      });
      finalizeDispatchManifest(root, turnId, identity);

      // Tamper
      writeFileSync(join(root, getDispatchTurnDir(turnId), 'EVIL.txt'), 'injected');

      const state = {
        run_id: 'run-test-001',
        current_turn: { turn_id: turnId, assigned_role: 'dev', runtime_id: 'cli', attempt: 1 },
        active_turns: { [turnId]: { turn_id: turnId, assigned_role: 'dev', runtime_id: 'cli', attempt: 1 } },
      };
      const config = {
        roles: { dev: { title: 'Developer', write_authority: 'authoritative' } },
        runtimes: { cli: { type: 'local_cli', command: 'echo', args: ['hello'] } },
      };

      const result = await dispatchLocalCli(root, state, config, { verifyManifest: true });
      assert.equal(result.ok, false);
      assert.match(result.error, /manifest verification failed/i);
      assert.match(result.error, /unexpected_file/);
    });
  });
});
