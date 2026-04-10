import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { join, dirname } from 'node:path';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  VALID_WORKFLOW_KIT_PHASE_TEMPLATE_IDS,
  listWorkflowKitPhaseTemplates,
} from '../src/lib/workflow-kit-phase-templates.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function runCli(args) {
  const dir = mkdtempSync(join(tmpdir(), 'axc-pt-'));
  // Create a minimal agentxchain.json so the CLI doesn't complain
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify({ schema_version: '1.0' }));
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
}

describe('template list --phase-templates', () => {
  it('outputs all built-in phase template ids in human-readable mode', () => {
    const result = runCli(['template', 'list', '--phase-templates']);
    assert.equal(result.status, 0, `exit 0, stderr: ${result.stderr}`);
    for (const id of VALID_WORKFLOW_KIT_PHASE_TEMPLATE_IDS) {
      assert.ok(result.stdout.includes(id), `stdout must include phase template "${id}"`);
    }
    assert.ok(result.stdout.includes('Workflow-kit phase templates'), 'must include section header');
    assert.ok(result.stdout.includes('workflow_kit'), 'must include config usage hint');
  });

  it('outputs valid JSON with --json flag', () => {
    const result = runCli(['template', 'list', '--phase-templates', '--json']);
    assert.equal(result.status, 0, `exit 0, stderr: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.ok(Array.isArray(parsed), 'JSON output must be an array');
    assert.equal(parsed.length, VALID_WORKFLOW_KIT_PHASE_TEMPLATE_IDS.length);
    for (const entry of parsed) {
      assert.ok(entry.id, 'each entry must have id');
      assert.ok(entry.description, 'each entry must have description');
      assert.ok(Array.isArray(entry.artifacts), 'each entry must have artifacts array');
      for (const a of entry.artifacts) {
        assert.ok(a.path, 'each artifact must have path');
        assert.ok(typeof a.required === 'boolean', 'each artifact must have boolean required');
      }
    }
  });

  it('JSON output matches the library function exactly', () => {
    const result = runCli(['template', 'list', '--phase-templates', '--json']);
    const cliOutput = JSON.parse(result.stdout);
    const libOutput = listWorkflowKitPhaseTemplates();
    assert.equal(cliOutput.length, libOutput.length);
    for (let i = 0; i < cliOutput.length; i++) {
      assert.equal(cliOutput[i].id, libOutput[i].id);
      assert.equal(cliOutput[i].description, libOutput[i].description);
      assert.equal(cliOutput[i].artifacts.length, libOutput[i].artifacts.length);
    }
  });

  it('architecture-review template includes required_sections in JSON output', () => {
    const result = runCli(['template', 'list', '--phase-templates', '--json']);
    const parsed = JSON.parse(result.stdout);
    const arch = parsed.find((t) => t.id === 'architecture-review');
    assert.ok(arch, 'architecture-review must be in output');
    const artifact = arch.artifacts[0];
    assert.equal(artifact.semantics, 'section_check');
    assert.ok(artifact.semantics_config?.required_sections, 'must include required_sections');
    assert.ok(artifact.semantics_config.required_sections.includes('## Context'));
  });

  it('human-readable output shows semantics and section details', () => {
    const result = runCli(['template', 'list', '--phase-templates']);
    assert.ok(result.stdout.includes('section_check'), 'must show section_check semantics');
    assert.ok(result.stdout.includes('## Context'), 'must show required sections for architecture-review');
    assert.ok(result.stdout.includes('## Threat Model'), 'must show required sections for security-review');
  });
});
