import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it } from 'vitest';
import {
  detectCIEnvironment,
  formatGitHubAnnotations,
  writeGitHubOutputVars,
  formatJUnitXml,
  deriveCIExitCode,
} from '../src/lib/ci-reporter.js';

// --- Helpers ---

function withEnv(overrides, fn) {
  const saved = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    if (overrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = overrides[key];
    }
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
}

// --- Test Fixtures ---

const PASSING_REPORT = {
  overall: 'pass',
  subject: {
    kind: 'governed_run',
    run: {
      run_id: 'run_test_001',
      status: 'active',
      phase: 'qa',
      blocked_on: null,
      blocked_reason: null,
      gate_summary: {
        planning_signoff: 'satisfied',
        implementation_complete: 'satisfied',
        qa_ship_verdict: 'pending',
      },
      turns: [
        { turn_id: 'turn_001', role: 'pm', status: 'accepted', duration_seconds: 45 },
        { turn_id: 'turn_002', role: 'dev', status: 'accepted', duration_seconds: 120 },
      ],
      decisions: [
        { id: 'DEC-001', statement: 'Test decision' },
      ],
      duration_seconds: 165,
    },
  },
};

const FAILING_REPORT = {
  overall: 'fail',
  message: 'governance check failed',
  subject: {
    kind: 'governed_run',
    run: {
      run_id: 'run_test_002',
      status: 'blocked',
      phase: 'implementation',
      blocked_on: 'credential_failure',
      blocked_reason: 'API key expired',
      gate_summary: {
        planning_signoff: 'satisfied',
        implementation_complete: 'pending',
      },
      turns: [
        { turn_id: 'turn_003', role: 'pm', status: 'accepted', duration_seconds: 30 },
        { turn_id: 'turn_004', role: 'dev', status: 'failed', summary: 'API key expired' },
      ],
      decisions: [],
      duration_seconds: 60,
    },
  },
};

// --- AT-CI-001 through AT-CI-004: CI Detection ---

describe('CI detection', () => {
  it('AT-CI-001: returns github_actions when GITHUB_ACTIONS=true', () => {
    withEnv({
      GITHUB_ACTIONS: 'true',
      GITLAB_CI: undefined,
      CI: 'true',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_RUN_ID: '12345',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_SHA: 'abc123',
    }, () => {
      const env = detectCIEnvironment();
      assert.equal(env.provider, 'github_actions');
      assert.equal(env.run_url, 'https://github.com/owner/repo/actions/runs/12345');
      assert.equal(env.run_id, '12345');
      assert.equal(env.ref, 'refs/heads/main');
      assert.equal(env.sha, 'abc123');
    });
  });

  it('AT-CI-002: returns gitlab_ci when GITLAB_CI=true', () => {
    withEnv({
      GITHUB_ACTIONS: undefined,
      GITLAB_CI: 'true',
      CI: 'true',
      CI_PIPELINE_URL: 'https://gitlab.com/project/-/pipelines/999',
      CI_PIPELINE_ID: '999',
      CI_COMMIT_REF_NAME: 'main',
      CI_COMMIT_SHA: 'def456',
    }, () => {
      const env = detectCIEnvironment();
      assert.equal(env.provider, 'gitlab_ci');
      assert.equal(env.run_url, 'https://gitlab.com/project/-/pipelines/999');
      assert.equal(env.run_id, '999');
      assert.equal(env.ref, 'main');
      assert.equal(env.sha, 'def456');
    });
  });

  it('AT-CI-003: returns generic when only CI=true', () => {
    withEnv({
      GITHUB_ACTIONS: undefined,
      GITLAB_CI: undefined,
      CI: 'true',
    }, () => {
      const env = detectCIEnvironment();
      assert.equal(env.provider, 'generic');
      assert.equal(env.run_url, null);
      assert.equal(env.run_id, null);
    });
  });

  it('AT-CI-004: returns null outside CI', () => {
    withEnv({
      GITHUB_ACTIONS: undefined,
      GITLAB_CI: undefined,
      CI: undefined,
    }, () => {
      const env = detectCIEnvironment();
      assert.equal(env, null);
    });
  });
});

// --- AT-CI-005 through AT-CI-007: GitHub Annotations ---

describe('GitHub annotations', () => {
  it('AT-CI-005: emits ::notice for passing run', () => {
    const output = formatGitHubAnnotations(PASSING_REPORT);
    assert.ok(output.includes('::notice title=AgentXchain Governance::'));
    assert.ok(output.includes('PASS'));
    assert.ok(output.includes('run_test_001'));
  });

  it('AT-CI-006: emits ::error for failing run', () => {
    const output = formatGitHubAnnotations(FAILING_REPORT);
    assert.ok(output.includes('::error title=AgentXchain Governance::'));
    assert.ok(output.includes('FAIL'));
    assert.ok(output.includes('run_test_002'));
  });

  it('AT-CI-007: includes gate-level annotations', () => {
    const output = formatGitHubAnnotations(PASSING_REPORT);
    // Satisfied gates get ::notice
    assert.ok(output.includes('::notice title=Gate planning_signoff::satisfied'));
    assert.ok(output.includes('::notice title=Gate implementation_complete::satisfied'));
    // Pending gate gets ::warning
    assert.ok(output.includes('::warning title=Gate qa_ship_verdict::pending'));
  });
});

// --- AT-CI-008: GitHub Output Variables ---

describe('GitHub output variables', () => {
  it('AT-CI-008: writes key=value pairs to file', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'ci-reporter-test-'));
    const outputPath = join(tmpDir, 'github_output');
    writeFileSync(outputPath, '');

    try {
      const pairs = writeGitHubOutputVars(PASSING_REPORT, outputPath);
      assert.ok(pairs.includes('run_status=pass'));
      assert.ok(pairs.includes('run_id=run_test_001'));
      assert.ok(pairs.includes('phase=qa'));
      assert.ok(pairs.includes('blocked=false'));
      assert.ok(pairs.includes('turn_count=2'));
      assert.ok(pairs.includes('decision_count=1'));

      const fileContents = readFileSync(outputPath, 'utf8');
      assert.ok(fileContents.includes('run_status=pass'));
      assert.ok(fileContents.includes('run_id=run_test_001'));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// --- AT-CI-009 through AT-CI-010: JUnit XML ---

describe('JUnit XML', () => {
  it('AT-CI-009: produces valid XML with testsuites and testcases', () => {
    const xml = formatJUnitXml(PASSING_REPORT);
    assert.ok(xml.includes('<?xml version="1.0" encoding="UTF-8"?>'));
    assert.ok(xml.includes('<testsuites name="AgentXchain Governance"'));
    assert.ok(xml.includes('<testsuite name="Gates"'));
    assert.ok(xml.includes('<testsuite name="Turns"'));
    assert.ok(xml.includes('<testcase name="planning_signoff"'));
    assert.ok(xml.includes('<testcase name="turn_001 (pm)"'));
    assert.ok(xml.includes('tests="5"')); // 3 gates + 2 turns
    assert.ok(xml.includes('time="165.0"'));
  });

  it('AT-CI-010: maps failed gates to failure elements', () => {
    const xml = formatJUnitXml(FAILING_REPORT);
    // implementation_complete is pending → failure
    assert.ok(xml.includes('<failure message="pending">'));
    assert.ok(xml.includes('implementation_complete gate status: pending'));
    // failed turn → failure
    assert.ok(xml.includes('<failure message="failed">'));
    assert.ok(xml.includes('API key expired'));
    // Verify failure counts
    assert.ok(xml.includes('failures="1"')); // 1 gate failure in Gates suite
  });
});

// --- AT-CI-011: Exit Code ---

describe('Exit code derivation', () => {
  it('AT-CI-011: returns 0 for pass, 1 for fail, 2 for error', () => {
    assert.equal(deriveCIExitCode({ overall: 'pass' }), 0);
    assert.equal(deriveCIExitCode({ overall: 'fail' }), 1);
    assert.equal(deriveCIExitCode({ overall: 'error' }), 2);
    assert.equal(deriveCIExitCode({ overall: 'unknown' }), 2);
  });
});

// --- AT-CI-012: Command Integration ---

describe('Command integration', () => {
  it('AT-CI-012: ci-report functions produce correct output and exit code for a report', () => {
    // Test the CI reporter functions directly on a pre-built report (clean integration test
    // that avoids coupling to export machinery internals)
    const annotations = formatGitHubAnnotations(PASSING_REPORT);
    assert.ok(annotations.length > 0, 'annotations should be non-empty');
    assert.ok(annotations.includes('::notice'), 'should contain GitHub annotation commands');

    const xml = formatJUnitXml(PASSING_REPORT);
    assert.ok(xml.length > 0, 'JUnit XML should be non-empty');
    assert.ok(xml.includes('<testsuites'), 'should contain testsuites root element');

    const exitCode = deriveCIExitCode(PASSING_REPORT);
    assert.equal(exitCode, 0, 'passing report should yield exit code 0');

    // Verify the failing report produces consistent outputs
    const failAnnotations = formatGitHubAnnotations(FAILING_REPORT);
    assert.ok(failAnnotations.includes('::error'), 'failing report should produce error annotation');

    const failXml = formatJUnitXml(FAILING_REPORT);
    assert.ok(failXml.includes('<failure'), 'failing report JUnit should contain failure elements');

    const failExitCode = deriveCIExitCode(FAILING_REPORT);
    assert.equal(failExitCode, 1, 'failing report should yield exit code 1');
  });
});
