import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scaffoldGoverned } from '../src/commands/init.js';

function scaffold(templateId) {
  const dir = mkdtempSync(join(tmpdir(), `agentxchain-roadmap-phase-test-${templateId}-`));
  scaffoldGoverned(dir, 'Test Project', 'test-project', templateId);
  return dir;
}

describe('scaffold ROADMAP.md phase table derived from routing', () => {
  const dirs = [];
  afterEach(() => {
    for (const d of dirs) {
      rmSync(d, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it('generic template scaffolds 3-phase table from default routing', () => {
    const dir = scaffold('generic');
    dirs.push(dir);
    const roadmap = readFileSync(join(dir, '.planning', 'ROADMAP.md'), 'utf8');
    assert.match(roadmap, /\| Planning \|/);
    assert.match(roadmap, /\| Implementation \|/);
    assert.match(roadmap, /\| Qa \|/);
    // Must have exactly 3 phase rows (header + separator + 3 rows)
    const rows = roadmap.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| Phase') && !line.startsWith('|--'));
    assert.equal(rows.length, 3, `expected 3 phase rows, got ${rows.length}: ${rows.join('; ')}`);
  });

  it('enterprise-app template scaffolds 5-phase table from blueprint routing', () => {
    const dir = scaffold('enterprise-app');
    dirs.push(dir);
    const roadmap = readFileSync(join(dir, '.planning', 'ROADMAP.md'), 'utf8');
    assert.match(roadmap, /\| Planning \|/);
    assert.match(roadmap, /\| Architecture \|/);
    assert.match(roadmap, /\| Implementation \|/);
    assert.match(roadmap, /\| Security Review \|/);
    assert.match(roadmap, /\| Qa \|/);
    const rows = roadmap.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| Phase') && !line.startsWith('|--'));
    assert.equal(rows.length, 5, `expected 5 phase rows, got ${rows.length}: ${rows.join('; ')}`);
  });

  it('first phase is In progress, rest are Pending', () => {
    const dir = scaffold('enterprise-app');
    dirs.push(dir);
    const roadmap = readFileSync(join(dir, '.planning', 'ROADMAP.md'), 'utf8');
    const rows = roadmap.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| Phase') && !line.startsWith('|--'));
    assert.match(rows[0], /In progress/);
    for (let i = 1; i < rows.length; i++) {
      assert.match(rows[i], /Pending/, `row ${i} should be Pending`);
    }
  });

  it('phase goals come from role mandates', () => {
    const dir = scaffold('enterprise-app');
    dirs.push(dir);
    const roadmap = readFileSync(join(dir, '.planning', 'ROADMAP.md'), 'utf8');
    // Architecture phase entry_role is architect, whose mandate mentions "system boundary"
    assert.match(roadmap, /Architecture.*system boundary/i);
    // Security Review entry_role is security_reviewer, whose mandate mentions "data handling"
    assert.match(roadmap, /Security Review.*data handling/i);
  });

  it('phase order matches routing key order', () => {
    const dir = scaffold('enterprise-app');
    dirs.push(dir);
    const roadmap = readFileSync(join(dir, '.planning', 'ROADMAP.md'), 'utf8');
    const rows = roadmap.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| Phase') && !line.startsWith('|--'));
    const phaseNames = rows.map((r) => r.split('|')[1].trim());
    assert.deepEqual(phaseNames, ['Planning', 'Architecture', 'Implementation', 'Security Review', 'Qa']);
  });
});
