import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function read(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

function compact(content) {
  return content.replace(/\s+/g, ' ');
}

describe('BUG-61 tester runbook content', () => {
  const release153 = read('website-v2/docs/releases/v2-153-0.mdx');
  const release1541 = read('website-v2/docs/releases/v2-154-1.mdx');
  const lightsOut = read('website-v2/docs/lights-out-operation.mdx');

  it('states the strict full-auto approval-policy precondition for shipped quote-back', () => {
    for (const content of [release153, release1541, lightsOut]) {
      const normalized = compact(content);
      assert.match(normalized, /approval_policy\.phase_transitions\.default === "auto_approve"/);
      assert.match(normalized, /approval_policy\.run_completion\.action === "auto_approve"/);
    }
  });

  it('states the explicit opt-in escape hatch when the strict detector does not apply', () => {
    for (const content of [release153, release1541, lightsOut]) {
      const normalized = compact(content);
      assert.match(normalized, /run_loop\.continuous\.auto_retry_on_ghost\.enabled: true/);
      assert.match(content, /--auto-retry-on-ghost/);
    }
  });

  it('warns that missing the precondition means manual recovery is expected, not a failed fix', () => {
    for (const content of [release153, release1541]) {
      assert.match(content, /auto-retry is disabled by design/i);
      assert.match(content, /manual `reissue-turn/i);
      assert.match(content, /DEC-BUG61-FULL-AUTO-DETECTOR-STRICT-V1-001/);
    }
  });

  it('points the public v2.153.0 quote-back command at the BUG-52-safe package', () => {
    assert.match(
      release153,
      /npx\s+--yes\s+-p\s+agentxchain@2\.154\.7\s+-c "agentxchain --version"/,
      'v2.153.0 release notes must use 2.154.7 as the current BUG-61 quote-back package target',
    );
    assert.match(
      release153,
      /BUG-52 realistic human-gate loop/,
      'v2.153.0 release notes must explain why the historical 2.153.0 pin is not the current safe tester target',
    );
    assert.doesNotMatch(
      release153,
      /npx\s+--yes\s+-p\s+agentxchain@2\.153\.0\s+-c "agentxchain --version"/,
      'v2.153.0 release notes may mention the historical version, but must not keep a live npx command pinned to it',
    );
    assert.doesNotMatch(
      release153,
      /output on `agentxchain@2\.152\.0` per that release's contract/,
      'v2.153.0 BUG-52 closure wording must not point operators back to the stale 2.152.0 contract',
    );
  });
});
