import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const SPEC_PATH = '.planning/PROTOCOL_SPEC.md';
const SPEC = readFileSync(join(REPO_ROOT, SPEC_PATH), 'utf8');

describe('Protocol core spec', () => {
  it('ships the durable planning spec with the required sections', () => {
    assert.ok(existsSync(join(REPO_ROOT, SPEC_PATH)), 'PROTOCOL_SPEC.md must exist');
    for (const heading of ['## Purpose', '## Interface', '## Behavior', '## Error Cases', '## Acceptance Tests', '## Open Questions']) {
      assert.match(SPEC, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });

  it('freezes the required repo-native artifacts', () => {
    for (const artifact of [
      '.agentxchain/state.json',
      'turn-result.json',
      '.agentxchain/history.jsonl',
      '.agentxchain/decision-ledger.jsonl',
      '.agentxchain/events.jsonl',
      '.agentxchain/run-history.jsonl',
      '.agentxchain-conformance/capabilities.json',
    ]) {
      assert.ok(SPEC.includes(artifact), `PROTOCOL_SPEC.md must mention ${artifact}`);
    }
  });

  it('defines the protocol boundary without collapsing into reference-runner product surfaces', () => {
    for (const term of [
      'roles are open-ended chartered actors',
      'review-only roles must challenge',
      'runners enforce the protocol; they are not the protocol',
      'connectors are replaceable execution bridges',
      'durability: "repo"',
      'durability: "run"',
      'overrides',
      '.agentxchain/missions/',
      'dashboard APIs',
      'export, report, and release operator surfaces',
      'non-reference runner may truthfully claim protocol `v7`',
    ]) {
      assert.ok(SPEC.includes(term), `PROTOCOL_SPEC.md must mention ${term}`);
    }
  });

  it('pins the current conformance surface set and tier model', () => {
    for (const term of [
      'state_machine',
      'turn_result_validation',
      'gate_semantics',
      'decision_ledger',
      'dispatch_manifest',
      'hook_audit',
      'coordinator',
      'parallel_turns',
      'event_lifecycle',
      'Tier 1',
      'Tier 2',
      'Tier 3',
    ]) {
      assert.ok(SPEC.includes(term), `PROTOCOL_SPEC.md must mention ${term}`);
    }
  });
});
