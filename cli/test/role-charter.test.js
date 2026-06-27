import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  evaluateRoleCharter,
  evaluateAllRoleCharters,
  buildRoleCharterSummary,
  ROLE_CHARTER_INVARIANT_IDS,
} from '../src/lib/role-charter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

// ── fixtures ────────────────────────────────────────────────────────────────

// Reference config: pm/dev/qa, authoritative on local_cli, each routed to a
// gated phase whose exit gate requires files. All three are well-formed.
function goodConfig() {
  return {
    schema_version: 4,
    template: 'generic',
    project: { id: 'p1', name: 'P1' },
    roles: {
      pm: { title: 'PM', mandate: 'Plan bounded increments.', write_authority: 'authoritative', runtime: 'local' },
      dev: { title: 'Dev', mandate: 'Build and verify.', write_authority: 'authoritative', runtime: 'local' },
      qa: { title: 'QA', mandate: 'Challenge ship readiness.', write_authority: 'authoritative', runtime: 'local' },
    },
    runtimes: { local: { type: 'local_cli' } },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['dev'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['qa'], exit_gate: 'implementation_complete' },
      qa: { entry_role: 'qa', allowed_next_roles: ['dev'], exit_gate: 'qa_ship_verdict' },
    },
    gates: {
      planning_signoff: { requires_files: ['.planning/PM_SIGNOFF.md'] },
      implementation_complete: { requires_files: ['.planning/IMPLEMENTATION_NOTES.md'] },
      qa_ship_verdict: { requires_files: ['.planning/ship-verdict.md'] },
    },
  };
}

// enterprise-app-shaped config: security_reviewer is review_only on a manual
// runtime, routed to a phase, and OWNS a required workflow-kit artifact.
function enterpriseConfig() {
  return {
    schema_version: 4,
    template: 'enterprise-app',
    project: { id: 'ent', name: 'Ent' },
    roles: {
      dev: { title: 'Dev', mandate: 'Implement.', write_authority: 'authoritative', runtime: 'local-dev' },
      security_reviewer: {
        title: 'Security Reviewer',
        mandate: 'Threat-model the shipped change and record findings.',
        write_authority: 'review_only',
        runtime: 'manual-security',
      },
    },
    runtimes: {
      'local-dev': { type: 'local_cli' },
      'manual-security': { type: 'manual' },
    },
    routing: {
      implementation: { entry_role: 'dev', allowed_next_roles: ['security_reviewer'], exit_gate: 'implementation_complete' },
      security_review: { entry_role: 'security_reviewer', allowed_next_roles: ['dev'], exit_gate: 'security_review_signoff' },
    },
    gates: {
      implementation_complete: { requires_files: ['.planning/IMPLEMENTATION_NOTES.md'] },
      security_review_signoff: { requires_files: ['.planning/SECURITY_REVIEW.md'] },
    },
    workflow_kit: {
      phases: {
        security_review: {
          artifacts: [{ path: '.planning/SECURITY_REVIEW.md', owned_by: 'security_reviewer', required: true }],
        },
      },
    },
  };
}

let tmpDirs = [];
function tmp(prefix = 'role-charter-') {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

function writeRepo(config) {
  const dir = tmp();
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2));
  mkdirSync(join(dir, '.agentxchain'), { recursive: true });
  return dir;
}

afterEach(() => {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tmpDirs = [];
});

function invariantById(report, id) {
  return report.invariants.find((inv) => inv.id === id);
}

// ── module: evaluateRoleCharter ─────────────────────────────────────────────

describe('evaluateRoleCharter — four-invariant scoring', () => {
  it('AT-RC-001: reference roles pm/dev/qa are each well-formed (4/4, empty missing)', () => {
    const config = goodConfig();
    for (const id of ['pm', 'dev', 'qa']) {
      const report = evaluateRoleCharter(config, config, id);
      expect(report.overall).toBe('well_formed');
      expect(report.missing).toEqual([]);
      expect(report.invariants.map((i) => i.id)).toEqual(ROLE_CHARTER_INVARIANT_IDS);
      expect(report.invariants.every((i) => i.satisfied)).toBe(true);
    }
  });

  it('AT-RC-002: enterprise custom role security_reviewer (routed + owns artifact) is well-formed', () => {
    const config = enterpriseConfig();
    const report = evaluateRoleCharter(config, config, 'security_reviewer');
    expect(report.overall).toBe('well_formed');
    expect(report.missing).toEqual([]);
    // review_only on manual is a coherent authority boundary (planning_only).
    expect(invariantById(report, 'authority_boundary').satisfied).toBe(true);
    // produces via ownership of .planning/SECURITY_REVIEW.md.
    expect(invariantById(report, 'produces_artifacts').satisfied).toBe(true);
  });

  it('AT-RC-003: empty mandate → incomplete, missing mandate, fix_hint present', () => {
    const config = goodConfig();
    config.roles.pm.mandate = '   ';
    const report = evaluateRoleCharter(config, config, 'pm');
    expect(report.overall).toBe('incomplete');
    expect(report.missing).toContain('mandate');
    const inv = invariantById(report, 'mandate');
    expect(inv.satisfied).toBe(false);
    expect(inv.fix_hint).toMatch(/mandate/);
  });

  it('AT-RC-004: review_only on local_cli (incoherent) → incomplete, missing authority_boundary', () => {
    const config = goodConfig();
    config.roles.pm.write_authority = 'review_only';
    const report = evaluateRoleCharter(config, config, 'pm');
    expect(report.overall).toBe('incomplete');
    expect(report.missing).toContain('authority_boundary');
    expect(invariantById(report, 'authority_boundary').satisfied).toBe(false);
    expect(invariantById(report, 'authority_boundary').fix_hint).toMatch(/authority|write path/i);
  });

  it('AT-RC-005: routed only to a non-file-producing phase, owns nothing → missing produces_artifacts', () => {
    const config = goodConfig();
    config.roles.observer = { title: 'Observer', mandate: 'Watch.', write_authority: 'authoritative', runtime: 'local' };
    // Routed only to a phase whose gate requires no files and has no owned artifacts.
    config.routing.review = { entry_role: 'observer', allowed_next_roles: [], exit_gate: 'review_gate' };
    config.gates.review_gate = { requires_files: [] };
    const report = evaluateRoleCharter(config, config, 'observer');
    expect(report.overall).toBe('incomplete');
    expect(report.missing).toEqual(['produces_artifacts']);
    expect(invariantById(report, 'workflow_participation').satisfied).toBe(true);
  });

  it('AT-RC-006: role absent from all routing → missing workflow_participation', () => {
    const config = goodConfig();
    config.roles.ghost = { title: 'Ghost', mandate: 'Lurk.', write_authority: 'authoritative', runtime: 'local' };
    const report = evaluateRoleCharter(config, config, 'ghost');
    expect(report.overall).toBe('incomplete');
    expect(report.missing).toContain('workflow_participation');
    expect(invariantById(report, 'workflow_participation').satisfied).toBe(false);
  });

  it('AT-RC-007: three failing invariants are all reported (no short-circuit)', () => {
    const config = goodConfig();
    // Empty mandate, not routed (→ no workflow, no production), but authority is coherent.
    config.roles.ghost = { title: 'Ghost', mandate: '', write_authority: 'authoritative', runtime: 'local' };
    const report = evaluateRoleCharter(config, config, 'ghost');
    expect(report.missing.sort()).toEqual(['mandate', 'produces_artifacts', 'workflow_participation']);
    // The non-failing invariant is still independently evaluated and satisfied.
    expect(invariantById(report, 'authority_boundary').satisfied).toBe(true);
  });

  it('AT-RC-009: well_formed iff 4/4 — flipping the single failing invariant flips overall', () => {
    const config = goodConfig();
    config.roles.dev.mandate = '';
    let report = evaluateRoleCharter(config, config, 'dev');
    expect(report.overall).toBe('incomplete');
    expect(report.missing).toEqual(['mandate']);

    config.roles.dev.mandate = 'Build and verify.';
    report = evaluateRoleCharter(config, config, 'dev');
    expect(report.overall).toBe('well_formed');
  });
});

// ── module: evaluateAllRoleCharters ─────────────────────────────────────────

describe('evaluateAllRoleCharters — aggregate report', () => {
  it('AT-RC-008: mixed config aggregates counts and sorts roles by id', () => {
    const config = goodConfig();
    config.roles.ghost = { title: 'Ghost', mandate: 'Lurk.', write_authority: 'authoritative', runtime: 'local' };
    const all = evaluateAllRoleCharters(config, config);
    expect(all.total).toBe(4);
    expect(all.well_formed).toBe(3);
    expect(all.incomplete).toBe(1);
    expect(all.incomplete_role_ids).toEqual(['ghost']);
    expect(all.roles.map((r) => r.role_id)).toEqual(['dev', 'ghost', 'pm', 'qa']); // sorted
    expect(all.well_formed + all.incomplete).toBe(all.total);
  });
});

// ── module: read-only invariant ─────────────────────────────────────────────

describe('evaluateRoleCharter / evaluateAllRoleCharters — read-only', () => {
  function snapshot(dir) {
    const snap = {};
    const walk = (rel) => {
      const abs = join(dir, rel);
      if (!existsSync(abs)) return;
      for (const entry of readdirSync(abs, { withFileTypes: true })) {
        const childRel = join(rel, entry.name);
        if (entry.isDirectory()) walk(childRel);
        else snap[childRel] = readFileSync(join(dir, childRel), 'utf8');
      }
    };
    walk('.agentxchain');
    snap['agentxchain.json'] = readFileSync(join(dir, 'agentxchain.json'), 'utf8');
    return snap;
  }

  it('AT-RC-013: scoring performs no writes (project files byte-identical)', () => {
    const config = goodConfig();
    const dir = writeRepo(config);
    const before = snapshot(dir);

    evaluateRoleCharter(config, config, 'pm');
    evaluateAllRoleCharters(config, config);

    expect(snapshot(dir)).toEqual(before);
    // Config object itself is not mutated.
    expect(config.roles.pm.mandate).toBe('Plan bounded increments.');
  });
});

// ── CLI: agentxchain role validate ──────────────────────────────────────────

describe('agentxchain role validate — CLI', () => {
  function runCli(dir, args = []) {
    return spawnSync('node', [BIN, 'role', 'validate', ...args], { cwd: dir, encoding: 'utf8' });
  }

  it('AT-RC-010: all roles well-formed → "all well-formed", exit 0', () => {
    const dir = writeRepo(goodConfig());
    const res = runCli(dir);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/all well-formed/);
  });

  it('AT-RC-011: an incomplete role present → lists role + missing + fix hint, exit 1', () => {
    const config = goodConfig();
    config.roles.ghost = { title: 'Ghost', mandate: 'Lurk.', write_authority: 'authoritative', runtime: 'local' };
    const dir = writeRepo(config);
    const res = runCli(dir);
    expect(res.status).toBe(1);
    expect(res.stdout).toMatch(/ghost/);
    expect(res.stdout).toMatch(/incomplete/);
    expect(res.stdout).toMatch(/workflow_participation/);
    expect(res.stdout).toMatch(/not in any phase routing/);
  });

  it('AT-RC-012: --json (all) emits AllRoleCharterReport schema', () => {
    const dir = writeRepo(goodConfig());
    const res = runCli(dir, ['--json']);
    expect(res.status).toBe(0);
    const report = JSON.parse(res.stdout);
    for (const key of ['total', 'well_formed', 'incomplete', 'incomplete_role_ids', 'roles']) {
      expect(report).toHaveProperty(key);
    }
    expect(Array.isArray(report.roles)).toBe(true);
  });

  it('AT-RC-012: --json (single role) emits RoleCharterReport schema and exit reflects outcome', () => {
    const config = goodConfig();
    config.roles.ghost = { title: 'Ghost', mandate: 'Lurk.', write_authority: 'authoritative', runtime: 'local' };
    const dir = writeRepo(config);

    const ok = runCli(dir, ['pm', '--json']);
    expect(ok.status).toBe(0);
    const okReport = JSON.parse(ok.stdout);
    for (const key of ['role_id', 'overall', 'invariants', 'missing', 'evidence_summary']) {
      expect(okReport).toHaveProperty(key);
    }
    expect(okReport.overall).toBe('well_formed');

    const bad = runCli(dir, ['ghost', '--json']);
    expect(bad.status).toBe(1);
    expect(JSON.parse(bad.stdout).overall).toBe('incomplete');
  });

  it('unknown role id → exit 1 with a clear message', () => {
    const dir = writeRepo(goodConfig());
    const res = runCli(dir, ['nope']);
    expect(res.status).toBe(1);
    expect(res.stdout).toMatch(/Unknown role/);
  });
});

// ── governance report integration ───────────────────────────────────────────

describe('buildRoleCharterSummary — governance report integration', () => {
  it('derives the compact role_charters summary from an export artifact', () => {
    const summary = buildRoleCharterSummary({ config: goodConfig() });
    expect(summary).toEqual({ total: 3, well_formed: 3, incomplete: 0, incomplete_role_ids: [] });
  });

  it('surfaces incomplete roles in the summary', () => {
    const config = goodConfig();
    config.roles.ghost = { title: 'Ghost', mandate: 'Lurk.', write_authority: 'authoritative', runtime: 'local' };
    const summary = buildRoleCharterSummary({ config });
    expect(summary.total).toBe(4);
    expect(summary.incomplete).toBe(1);
    expect(summary.incomplete_role_ids).toEqual(['ghost']);
  });

  it('returns null for a missing artifact', () => {
    expect(buildRoleCharterSummary(null)).toBe(null);
  });
});
