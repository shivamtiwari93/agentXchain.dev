import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isOperationalPath } from '../src/lib/repo-observer.js';

// ── Framework-Owned Write Paths ─────────────────────────────────────────────
// Every file path the framework writes to MUST be excluded from agent-attributed
// observation. If a framework-owned path is NOT operational, it poisons
// retained-turn artifact observation as an "undeclared file change."
//
// This test exists because of BUG-45 (HUMAN_TASKS.md was missing) and the
// broader audit the roadmap demanded. Any new framework write surface must
// be added here FIRST (test-driven), then to repo-observer.js.

describe('framework-owned write paths are excluded from agent observation', () => {

  // ── Prefix-excluded paths ───────────────────────────────────────────────
  const PREFIX_EXCLUDED_PATHS = [
    // dispatch lifecycle
    '.agentxchain/dispatch/turns/turn_abc123/MANIFEST.json',
    '.agentxchain/dispatch/rejected/turn_abc-attempt-1-2026-04-19.json',
    '.agentxchain/dispatch-progress-turn_abc123.json',
    // staging
    '.agentxchain/staging/turn_abc123/turn-result.json',
    // intake
    '.agentxchain/intake/intents/intent_123.json',
    '.agentxchain/intake/observations/intent_123/obs.json',
    '.agentxchain/intake/events/evt_123.json',
    '.agentxchain/intake/loop-state.json',
    '.agentxchain/intake/injected-priority.json',
    // locks / transactions
    '.agentxchain/locks/acceptance.lock',
    '.agentxchain/transactions/txn_123.json',
    // missions
    '.agentxchain/missions/mission_abc.json',
    // coordinator / multirepo
    '.agentxchain/multirepo/barriers.json',
    '.agentxchain/multirepo/barrier-ledger.jsonl',
    '.agentxchain/multirepo/history.jsonl',
    '.agentxchain/multirepo/context/ctx_123/COORDINATOR_CONTEXT.json',
    '.agentxchain/multirepo/context/ctx_123/COORDINATOR_CONTEXT.md',
    '.agentxchain/multirepo/handoffs/intent_123.json',
  ];

  for (const path of PREFIX_EXCLUDED_PATHS) {
    it(`prefix-excluded: ${path}`, () => {
      assert.ok(isOperationalPath(path), `${path} should be operational but is NOT — framework writes here will poison observation`);
    });
  }

  // ── File-excluded paths ─────────────────────────────────────────────────
  const FILE_EXCLUDED_PATHS = [
    '.agentxchain/state.json',
    '.agentxchain/session.json',
    '.agentxchain/history.jsonl',
    '.agentxchain/decision-ledger.jsonl',
    '.agentxchain/lock.json',
    '.agentxchain/hook-audit.jsonl',
    '.agentxchain/hook-annotations.jsonl',
    '.agentxchain/run-history.jsonl',
    '.agentxchain/events.jsonl',
    '.agentxchain/notification-audit.jsonl',
    '.agentxchain/schedule-state.json',
    '.agentxchain/schedule-daemon.json',
    '.agentxchain/continuous-session.json',
    '.agentxchain/human-escalations.jsonl',
    '.agentxchain/sla-reminders.json',
    'TALK.md',
    'HUMAN_TASKS.md',
  ];

  for (const path of FILE_EXCLUDED_PATHS) {
    it(`file-excluded: ${path}`, () => {
      assert.ok(isOperationalPath(path), `${path} should be operational but is NOT`);
    });
  }

  // ── Agent-owned paths that MUST NOT be excluded ─────────────────────────
  const AGENT_OWNED_PATHS = [
    'src/index.js',
    'README.md',
    '.planning/ROADMAP.md',
    '.planning/IMPLEMENTATION_NOTES.md',
    'package.json',
    'agentxchain.json',
  ];

  for (const path of AGENT_OWNED_PATHS) {
    it(`agent-owned (not excluded): ${path}`, () => {
      assert.ok(!isOperationalPath(path), `${path} should NOT be operational — agent work here must be observed`);
    });
  }
});
