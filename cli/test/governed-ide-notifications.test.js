import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scaffoldGoverned } from '../src/commands/init.js';
import { importCompiledVsCodeExtensionModule } from '../test-support/vscode-extension-test-helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const CLI_BIN = join(REPO_ROOT, 'cli', 'bin', 'agentxchain.js');
const EXTENSION_ROOT = join(REPO_ROOT, 'cli', 'vscode-extension');

let notificationStateModule;
let governedStatusModule;
const tempDirs = [];
const originalCliPath = process.env.AGENTXCHAIN_CLI_PATH;

before(async () => {
  process.env.AGENTXCHAIN_CLI_PATH = CLI_BIN;
  // notificationState.js has no vscode dependency — safe to import in tests
  notificationStateModule = await importCompiledVsCodeExtensionModule('notificationState.js');
  governedStatusModule = await importCompiledVsCodeExtensionModule('governedStatus.js');
});

after(() => {
  if (originalCliPath == null) {
    delete process.env.AGENTXCHAIN_CLI_PATH;
  } else {
    process.env.AGENTXCHAIN_CLI_PATH = originalCliPath;
  }

  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createGovernedFixture(stateOverrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'axc-ide-notif-'));
  tempDirs.push(dir);
  scaffoldGoverned(dir, 'Notification Fixture', 'notif-fixture');

  const statePath = join(dir, '.agentxchain', 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  Object.assign(state, {
    status: 'active',
    phase: 'implementation',
    run_id: 'run_notif_test',
    turn_sequence: 3,
    blocked: false,
    blocked_on: null,
    active_turns: {},
    ...stateOverrides,
  });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

  writeFileSync(
    join(dir, '.agentxchain', 'session.json'),
    JSON.stringify({
      session_id: 'session-notif-test',
      run_id: 'run_notif_test',
      last_checkpoint_at: new Date().toISOString(),
      checkpoint_reason: 'test_init',
      last_turn_id: 'turn-003',
      last_role: 'dev',
      baseline_ref: { sha: 'abc123', branch: 'main', clean: true },
    }, null, 2) + '\n'
  );

  return { dir, statePath };
}

describe('Governed IDE Notifications — snapshotFromPayload', () => {
  it('produces correct snapshot from a normal active payload', () => {
    const payload = {
      protocol_mode: 'governed',
      state: {
        phase: 'implementation',
        status: 'active',
        turn_sequence: 5,
        blocked: false,
        blocked_on: null,
        pending_phase_transition: null,
        pending_run_completion: null,
      },
    };
    const snap = notificationStateModule.snapshotFromPayload(payload);
    assert.equal(snap.pendingTransitionGate, null);
    assert.equal(snap.pendingCompletionGate, null);
    assert.equal(snap.blocked, false);
    assert.equal(snap.blockedReason, null);
    assert.equal(snap.turnSequence, 5);
  });

  it('captures pending_phase_transition gate', () => {
    const payload = {
      protocol_mode: 'governed',
      state: {
        phase: 'implementation',
        status: 'paused',
        turn_sequence: 5,
        pending_phase_transition: { from: 'implementation', to: 'qa', gate: 'impl_exit_gate' },
        pending_run_completion: null,
      },
    };
    const snap = notificationStateModule.snapshotFromPayload(payload);
    assert.equal(snap.pendingTransitionGate, 'impl_exit_gate');
    assert.equal(snap.pendingCompletionGate, null);
  });

  it('captures pending_run_completion gate', () => {
    const payload = {
      protocol_mode: 'governed',
      state: {
        phase: 'qa',
        status: 'paused',
        turn_sequence: 8,
        pending_phase_transition: null,
        pending_run_completion: { gate: 'final_approval' },
      },
    };
    const snap = notificationStateModule.snapshotFromPayload(payload);
    assert.equal(snap.pendingTransitionGate, null);
    assert.equal(snap.pendingCompletionGate, 'final_approval');
  });

  it('captures blocked state from status field', () => {
    const payload = {
      protocol_mode: 'governed',
      state: {
        phase: 'implementation',
        status: 'blocked',
        turn_sequence: 4,
        blocked: true,
        blocked_on: 'human:approval_needed',
        blocked_reason: 'dispatch failure',
      },
    };
    const snap = notificationStateModule.snapshotFromPayload(payload);
    assert.equal(snap.blocked, true);
    assert.equal(snap.blockedReason, 'dispatch failure');
  });

  it('handles null state gracefully', () => {
    const payload = { protocol_mode: 'governed', state: null };
    const snap = notificationStateModule.snapshotFromPayload(payload);
    assert.equal(snap.pendingTransitionGate, null);
    assert.equal(snap.pendingCompletionGate, null);
    assert.equal(snap.blocked, false);
    assert.equal(snap.turnSequence, 0);
  });

  it('uses blocked_on as fallback when blocked_reason is absent', () => {
    const payload = {
      protocol_mode: 'governed',
      state: {
        status: 'blocked',
        blocked: true,
        blocked_on: 'human:escalation',
        blocked_reason: null,
        turn_sequence: 2,
      },
    };
    const snap = notificationStateModule.snapshotFromPayload(payload);
    assert.equal(snap.blocked, true);
    assert.equal(snap.blockedReason, 'human:escalation');
  });
});

describe('Governed IDE Notifications — diffRequiresNotification', () => {
  const base = {
    pendingTransitionGate: null,
    pendingCompletionGate: null,
    blocked: false,
    blockedReason: null,
    turnSequence: 3,
  };

  it('detects new pending phase transition', () => {
    const prev = { ...base };
    const current = { ...base, pendingTransitionGate: 'gate_1' };
    const diff = notificationStateModule.diffRequiresNotification(prev, current);
    assert.equal(diff.pendingTransition, true);
    assert.equal(diff.pendingCompletion, false);
    assert.equal(diff.blocked, false);
    assert.equal(diff.turnCompleted, false);
  });

  it('does not re-notify for same pending transition', () => {
    const prev = { ...base, pendingTransitionGate: 'gate_1' };
    const current = { ...base, pendingTransitionGate: 'gate_1' };
    const diff = notificationStateModule.diffRequiresNotification(prev, current);
    assert.equal(diff.pendingTransition, false);
  });

  it('detects new pending run completion', () => {
    const prev = { ...base };
    const current = { ...base, pendingCompletionGate: 'final_gate' };
    const diff = notificationStateModule.diffRequiresNotification(prev, current);
    assert.equal(diff.pendingCompletion, true);
  });

  it('detects transition to blocked', () => {
    const prev = { ...base };
    const current = { ...base, blocked: true, blockedReason: 'dispatch error' };
    const diff = notificationStateModule.diffRequiresNotification(prev, current);
    assert.equal(diff.blocked, true);
  });

  it('does not re-notify if already blocked', () => {
    const prev = { ...base, blocked: true, blockedReason: 'old error' };
    const current = { ...base, blocked: true, blockedReason: 'old error' };
    const diff = notificationStateModule.diffRequiresNotification(prev, current);
    assert.equal(diff.blocked, false);
  });

  it('detects turn completion', () => {
    const prev = { ...base, turnSequence: 3 };
    const current = { ...base, turnSequence: 4 };
    const diff = notificationStateModule.diffRequiresNotification(prev, current);
    assert.equal(diff.turnCompleted, true);
  });

  it('no notification when nothing changed', () => {
    const prev = { ...base };
    const current = { ...base };
    const diff = notificationStateModule.diffRequiresNotification(prev, current);
    assert.equal(diff.pendingTransition, false);
    assert.equal(diff.pendingCompletion, false);
    assert.equal(diff.blocked, false);
    assert.equal(diff.turnCompleted, false);
  });

  it('detects multiple simultaneous changes', () => {
    const prev = { ...base };
    const current = {
      ...base,
      pendingTransitionGate: 'gate_x',
      blocked: true,
      blockedReason: 'error',
      turnSequence: 5,
    };
    const diff = notificationStateModule.diffRequiresNotification(prev, current);
    assert.equal(diff.pendingTransition, true);
    assert.equal(diff.blocked, true);
    assert.equal(diff.turnCompleted, true);
  });
});

describe('Governed IDE Notifications — module exports', () => {
  it('exports snapshotFromPayload function', () => {
    assert.equal(typeof notificationStateModule.snapshotFromPayload, 'function');
  });

  it('exports diffRequiresNotification function', () => {
    assert.equal(typeof notificationStateModule.diffRequiresNotification, 'function');
  });
});

describe('Governed IDE Notifications — extension wiring', () => {
  it('extension.ts imports GovernedNotificationService', () => {
    const extensionSrc = readFileSync(
      join(EXTENSION_ROOT, 'src', 'extension.ts'),
      'utf8'
    );
    assert.ok(
      extensionSrc.includes("import { GovernedNotificationService } from './notifications'"),
      'extension.ts must import GovernedNotificationService'
    );
  });

  it('extension.ts calls notificationService.check() on state change', () => {
    const extensionSrc = readFileSync(
      join(EXTENSION_ROOT, 'src', 'extension.ts'),
      'utf8'
    );
    assert.ok(
      extensionSrc.includes('notificationService.check()'),
      'extension.ts must call notificationService.check() in the watcher callback'
    );
  });

  it('extension.ts seeds notification baseline on activation before watcher registration', () => {
    const extensionSrc = readFileSync(
      join(EXTENSION_ROOT, 'src', 'extension.ts'),
      'utf8'
    );
    const lines = extensionSrc.split('\n');
    const seedLine = lines.findIndex(l => l.includes('notificationService.check()'));
    const watcherLine = lines.findIndex(l => l.includes('watchers.onStateChange'));
    assert.ok(seedLine >= 0, 'must have a seed check call');
    assert.ok(watcherLine >= 0, 'must have a watcher callback');
    assert.ok(
      seedLine < watcherLine,
      'seed check must come before watcher registration to avoid spurious notifications on activation'
    );
  });

  it('notifications.ts uses diffRequiresNotification for state comparison', () => {
    const notifSrc = readFileSync(
      join(EXTENSION_ROOT, 'src', 'notifications.ts'),
      'utf8'
    );
    assert.ok(
      notifSrc.includes('diffRequiresNotification'),
      'notifications.ts must use diffRequiresNotification for state diff logic'
    );
  });

  it('notifications.ts suppresses turn-completion toasts while an IDE-launched run terminal is active', () => {
    const notifSrc = readFileSync(
      join(EXTENSION_ROOT, 'src', 'notifications.ts'),
      'utf8'
    );
    assert.ok(
      notifSrc.includes("import { hasActiveGovernedRunTerminal } from './runTerminal'"),
      'notifications.ts must consult active governed run terminals'
    );
    assert.match(
      notifSrc,
      /diff\.turnCompleted && !hasActiveGovernedRunTerminal\(\)/,
      'turn-completion notifications must be suppressed while a governed run terminal is active'
    );
  });

  it('notifications.ts fires approve commands via vscode.commands.executeCommand', () => {
    const notifSrc = readFileSync(
      join(EXTENSION_ROOT, 'src', 'notifications.ts'),
      'utf8'
    );
    assert.ok(
      notifSrc.includes("'agentxchain.approveTransition'"),
      'must trigger approveTransition command'
    );
    assert.ok(
      notifSrc.includes("'agentxchain.approveCompletion'"),
      'must trigger approveCompletion command'
    );
  });
});

describe('Governed IDE Notifications — no direct governed state writes', () => {
  it('notifications.ts does not import fs write functions', () => {
    const notifSrc = readFileSync(
      join(EXTENSION_ROOT, 'src', 'notifications.ts'),
      'utf8'
    );
    const forbidden = ['writeFileSync', 'writeFile', 'mkdirSync', 'mkdir', 'writeJson'];
    for (const fn of forbidden) {
      assert.ok(
        !notifSrc.includes(fn),
        `notifications.ts must not contain ${fn}`
      );
    }
  });

  it('notificationState.ts does not import fs write functions', () => {
    const stateSrc = readFileSync(
      join(EXTENSION_ROOT, 'src', 'notificationState.ts'),
      'utf8'
    );
    const forbidden = ['writeFileSync', 'writeFile', 'mkdirSync', 'mkdir', 'writeJson', 'vscode'];
    for (const fn of forbidden) {
      assert.ok(
        !stateSrc.includes(fn),
        `notificationState.ts must not contain ${fn} — pure state logic only`
      );
    }
  });
});

describe('Governed IDE Notifications — package.json surface', () => {
  it('notification service does not add notification-only commands and package.json now includes the governed surface', () => {
    const pkg = JSON.parse(readFileSync(join(EXTENSION_ROOT, 'package.json'), 'utf8'));
    const commands = pkg.contributes?.commands ?? [];
    const commandIds = commands.map(c => c.command);
    assert.ok(
      !commandIds.some(id => id.includes('notification')),
      'notification service must not register new commands — it reuses existing approval commands'
    );
    assert.equal(commandIds.length, 12, 'should now have exactly 12 commands');
    assert.ok(commandIds.includes('agentxchain.run'), 'package.json must declare agentxchain.run');
    assert.ok(commandIds.includes('agentxchain.report'), 'package.json must declare agentxchain.report');
    assert.ok(commandIds.includes('agentxchain.restart'), 'package.json must declare agentxchain.restart');
    assert.ok(commandIds.includes('agentxchain.openDashboard'), 'package.json must declare agentxchain.openDashboard');
  });
});

describe('Governed IDE Notifications — CLI subprocess integration', () => {
  it('loadGovernedStatus produces a payload snapshotFromPayload can consume', async () => {
    const { dir } = createGovernedFixture();
    const payload = await governedStatusModule.loadGovernedStatus(dir);
    const snap = notificationStateModule.snapshotFromPayload(payload);
    assert.equal(snap.pendingTransitionGate, null);
    assert.equal(typeof snap.blocked, 'boolean');
    assert.equal(typeof snap.turnSequence, 'number');
    assert.equal(snap.turnSequence, 3);
  });

  it('snapshot reflects pending_phase_transition from CLI status', async () => {
    const { dir } = createGovernedFixture({
      status: 'paused',
      pending_phase_transition: {
        from: 'implementation',
        to: 'qa',
        gate: 'human_review_gate',
        requested_by_turn: 'turn-003',
      },
    });
    const payload = await governedStatusModule.loadGovernedStatus(dir);
    const snap = notificationStateModule.snapshotFromPayload(payload);
    assert.equal(snap.pendingTransitionGate, 'human_review_gate');
  });

  it('snapshot reflects blocked state from CLI status', async () => {
    const { dir } = createGovernedFixture({
      status: 'blocked',
      blocked: true,
      blocked_on: 'human:operator_escalation',
      blocked_reason: {
        category: 'operator_escalation',
        blocked_at: new Date().toISOString(),
        turn_id: 'turn-003',
        recovery: {
          typed_reason: 'operator_escalation',
          owner: 'human',
          recovery_action: 'agentxchain restart',
          turn_retained: false,
          detail: 'escalation test',
        },
      },
    });
    const payload = await governedStatusModule.loadGovernedStatus(dir);
    const snap = notificationStateModule.snapshotFromPayload(payload);
    assert.equal(snap.blocked, true);
  });

  it('diff between two real CLI snapshots detects transition change', async () => {
    const { dir, statePath } = createGovernedFixture();
    const payload1 = await governedStatusModule.loadGovernedStatus(dir);
    const snap1 = notificationStateModule.snapshotFromPayload(payload1);

    // Mutate state to add a pending phase transition
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    state.status = 'paused';
    state.pending_phase_transition = {
      from: 'implementation',
      to: 'qa',
      gate: 'review_gate',
      requested_by_turn: 'turn-003',
    };
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

    const payload2 = await governedStatusModule.loadGovernedStatus(dir);
    const snap2 = notificationStateModule.snapshotFromPayload(payload2);

    const diff = notificationStateModule.diffRequiresNotification(snap1, snap2);
    assert.equal(diff.pendingTransition, true);
    assert.equal(diff.pendingCompletion, false);
    assert.equal(diff.blocked, false);
  });
});
