import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildCoordinatorAttentionSnapshotPresentation,
  getCoordinatorAttentionStatusCard,
  getCoordinatorBlockerDetails,
  summarizeCoordinatorAttention,
} from '../src/lib/coordinator-blocker-presentation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const initiativeSource = readFileSync(join(__dirname, '..', 'dashboard', 'components', 'initiative.js'), 'utf8');
const blockersSource = readFileSync(join(__dirname, '..', 'dashboard', 'components', 'blockers.js'), 'utf8');

describe('coordinator blocker presentation helper', () => {
  it('AT-CBPS-001: returns typed detail rows for supported coordinator blockers', () => {
    assert.deepEqual(
      getCoordinatorBlockerDetails({
        code: 'repo_run_id_mismatch',
        repo_id: 'api',
        expected_run_id: 'run_api_001',
        actual_run_id: 'run_api_999',
      }),
      [
        { label: 'Repo', value: 'api', mono: true },
        { label: 'Expected', value: 'run_api_001', mono: true },
        { label: 'Actual', value: 'run_api_999', mono: true },
      ],
    );

    assert.deepEqual(
      getCoordinatorBlockerDetails({
        code: 'repo_not_ready',
        repo_id: 'web',
        current_phase: 'integration',
        required_phase: 'release',
      }),
      [
        { label: 'Repo', value: 'web', mono: true },
        { label: 'Current Phase', value: 'integration', mono: false },
        { label: 'Required Phase', value: 'release', mono: false },
      ],
    );
  });

  it('AT-CBPS-002: summarizes primary coordinator attention without inlining full blocker lists', () => {
    const summary = summarizeCoordinatorAttention({
      ok: true,
      mode: 'phase_transition',
      active: {
        blockers: [
          { code: 'no_next_phase', message: 'already final' },
          {
            code: 'repo_run_id_mismatch',
            message: 'Repo "api" drifted',
            repo_id: 'api',
            expected_run_id: 'run_api_001',
            actual_run_id: 'run_api_999',
          },
          {
            code: 'repo_not_ready',
            message: 'Repo "web" has not reached release',
            repo_id: 'web',
            current_phase: 'integration',
            required_phase: 'release',
          },
        ],
      },
      next_actions: [
        {
          code: 'repo_run_id_mismatch',
          command: 'agentxchain multi resume',
          reason: 'Resume after reconciling repo drift.',
        },
        {
          code: 'resync',
          command: 'agentxchain multi resync',
          reason: 'Resync after resume if needed.',
        },
      ],
    });

    assert.equal(summary.title, 'Blocker Snapshot');
    assert.equal(summary.primaryBlocker.code, 'repo_run_id_mismatch');
    assert.equal(summary.primaryAction.command, 'agentxchain multi resume');
    assert.equal(summary.additionalBlockerCount, 1);
    assert.equal(summary.additionalActionCount, 1);
    assert.equal(summary.blockers.some((blocker) => blocker.code === 'no_next_phase'), false);
  });

  it('AT-CBPS-003: dashboard renderers consume the shared helper instead of duplicating typed blocker detail fields inline', () => {
    assert.match(initiativeSource, /buildCoordinatorAttentionSnapshotPresentation/);
    assert.match(blockersSource, /getCoordinatorAttentionStatusCard/);
    assert.match(initiativeSource, /summarizeCoordinatorAttention/);
    assert.match(blockersSource, /getCoordinatorBlockerDetails/);

    assert.doesNotMatch(initiativeSource, /primaryBlocker\.(expected_run_id|actual_run_id|current_phase|required_phase)/);
    assert.doesNotMatch(blockersSource, /blocker\.(expected_run_id|actual_run_id|current_phase|required_phase)/);
  });

  it('AT-CBPS-004: shared snapshot presentation emits canonical summary labels and subtitle', () => {
    const presentation = buildCoordinatorAttentionSnapshotPresentation({
      ok: true,
      mode: 'phase_transition',
      active: {
        gate_type: 'phase_transition',
        gate_id: 'phase_transition:integration->release',
        current_phase: 'integration',
        target_phase: 'release',
        blockers: [
          {
            code: 'repo_run_id_mismatch',
            message: 'Repo "api" drifted',
            repo_id: 'api',
            expected_run_id: 'run_api_001',
            actual_run_id: 'run_api_999',
          },
        ],
      },
      next_actions: [
        {
          command: 'agentxchain multi resume',
          reason: 'Resume after reconciling repo drift.',
        },
      ],
    });

    assert.equal(presentation.title, 'Blocker Snapshot');
    assert.equal(
      presentation.subtitle,
      'First-glance coordinator attention only. Full blocker diagnostics stay in the Blockers view.',
    );
    assert.deepEqual(
      presentation.details,
      [
        { label: 'Mode', value: 'phase_transition', mono: false },
        { label: 'Type', value: 'phase_transition', mono: false },
        { label: 'Gate', value: 'phase_transition:integration->release', mono: true },
        { label: 'Current Phase', value: 'integration', mono: false },
        { label: 'Target Phase', value: 'release', mono: false },
        { label: 'Blockers', value: '1', mono: false },
        { label: 'Primary Blocker', value: 'repo_run_id_mismatch', mono: true },
      ],
    );
  });

  it('AT-CBPS-005: shared status-card helper emits canonical pending-approval and gate-clear summaries', () => {
    assert.deepEqual(
      getCoordinatorAttentionStatusCard({
        ok: true,
        mode: 'pending_gate',
        active: { blockers: [] },
      }),
      {
        title: 'Approval Snapshot',
        message: 'All coordinator prerequisites are satisfied. Human approval is the remaining action.',
      },
    );

    assert.deepEqual(
      getCoordinatorAttentionStatusCard({
        ok: true,
        mode: 'phase_transition',
        active: { blockers: [] },
      }),
      {
        title: 'Gate Clear',
        message: 'The coordinator gate has no outstanding blockers.',
      },
    );
  });

  it('AT-CBPS-006: Initiative and Blockers no longer hardcode coordinator attention summary titles or status copy inline', () => {
    assert.doesNotMatch(initiativeSource, /First-glance coordinator attention only\./);
    assert.doesNotMatch(blockersSource, /Awaiting Approval|No Blockers/);
    assert.doesNotMatch(blockersSource, /All prerequisites are satisfied\. The coordinator is waiting for human gate approval\./);
  });

  it('AT-CBPS-007: approval snapshots absorb pending-gate detail rows so Initiative does not render a second pending-gate card', () => {
    const presentation = buildCoordinatorAttentionSnapshotPresentation({
      ok: true,
      mode: 'pending_gate',
      pending_gate: {
        gate_type: 'phase_transition',
        gate: 'phase_transition:integration->release',
        from: 'integration',
        to: 'release',
        required_repos: ['api', 'web'],
      },
      active: {
        gate_type: 'phase_transition',
        gate_id: 'phase_transition:integration->release',
        current_phase: 'integration',
        target_phase: 'release',
        blockers: [],
        pending: true,
      },
      next_actions: [
        {
          command: 'agentxchain multi approve-gate',
          reason: 'Coordinator is waiting on human gate approval.',
        },
      ],
    });

    assert.equal(presentation.title, 'Approval Snapshot');
    assert.deepEqual(
      presentation.details,
      [
        { label: 'Mode', value: 'pending_gate', mono: false },
        { label: 'Type', value: 'phase_transition', mono: false },
        { label: 'Gate', value: 'phase_transition:integration->release', mono: true },
        { label: 'Current Phase', value: 'integration', mono: false },
        { label: 'Target Phase', value: 'release', mono: false },
        { label: 'Required Repos', value: 'api, web', mono: false },
        { label: 'Approval State', value: 'Awaiting human approval', mono: false },
      ],
    );
    assert.equal(
      presentation.summaryMessage,
      'All coordinator prerequisites are satisfied. Human approval is the remaining action.',
    );
    assert.doesNotMatch(initiativeSource, /<h3>Pending Gate<\/h3>/);
    assert.doesNotMatch(initiativeSource, /Approval is the only remaining action\. Detailed gate diagnostics stay in the Gates and Blockers views\./);
  });
});
