import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveNextAgent } from '../src/lib/next-owner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, '.tmp-next-owner-test');

function setup() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
}

function cleanup() {
  rmSync(TMP, { recursive: true, force: true });
}

const CONFIG = {
  agents: { pm: { name: 'PM' }, dev: { name: 'Dev' }, qa: { name: 'QA' } },
  talk_file: 'TALK.md'
};

describe('resolveNextAgent', () => {
  it('falls back to first agent when no TALK.md and no last_released_by', () => {
    setup();
    const result = resolveNextAgent(TMP, CONFIG, {});
    assert.equal(result.next, 'pm');
    assert.equal(result.source, 'fallback-first');
    cleanup();
  });

  it('uses cyclic fallback when last_released_by is set', () => {
    setup();
    const result = resolveNextAgent(TMP, CONFIG, { last_released_by: 'pm' });
    assert.equal(result.next, 'dev');
    assert.equal(result.source, 'fallback-cyclic');
    cleanup();
  });

  it('wraps around cyclically', () => {
    setup();
    const result = resolveNextAgent(TMP, CONFIG, { last_released_by: 'qa' });
    assert.equal(result.next, 'pm');
    cleanup();
  });

  it('parses "Next owner:" from TALK.md', () => {
    setup();
    writeFileSync(join(TMP, 'TALK.md'), '## Turn 1\n- Next owner: dev\n');
    const result = resolveNextAgent(TMP, CONFIG, {});
    assert.equal(result.next, 'dev');
    assert.equal(result.source, 'talk');
    cleanup();
  });

  it('parses "**Next owner**: dev" with markdown formatting', () => {
    setup();
    writeFileSync(join(TMP, 'TALK.md'), '## Turn 1\n- **Next owner**: dev\n');
    const result = resolveNextAgent(TMP, CONFIG, {});
    assert.equal(result.next, 'dev');
    cleanup();
  });

  it('parses "Handoff to: qa"', () => {
    setup();
    writeFileSync(join(TMP, 'TALK.md'), '## Turn 1\n- Handoff to: qa\n');
    const result = resolveNextAgent(TMP, CONFIG, {});
    assert.equal(result.next, 'qa');
    cleanup();
  });

  it('parses agent id with parenthetical name "dev (Developer)"', () => {
    setup();
    writeFileSync(join(TMP, 'TALK.md'), '- Next owner: dev (Developer)\n');
    const result = resolveNextAgent(TMP, CONFIG, {});
    assert.equal(result.next, 'dev');
    cleanup();
  });

  it('ignores invalid agent ids in TALK.md', () => {
    setup();
    writeFileSync(join(TMP, 'TALK.md'), '- Next owner: nonexistent\n');
    const result = resolveNextAgent(TMP, CONFIG, { last_released_by: 'pm' });
    assert.equal(result.next, 'dev');
    assert.equal(result.source, 'fallback-cyclic');
    cleanup();
  });

  it('strict_next_owner returns null when TALK has no valid handoff', () => {
    setup();
    const strictConfig = { ...CONFIG, rules: { strict_next_owner: true } };
    const result = resolveNextAgent(TMP, strictConfig, { last_released_by: 'pm' });
    assert.equal(result.next, null);
    assert.equal(result.source, 'strict-missing');
    cleanup();
  });

  it('strict_next_owner still uses TALK when present', () => {
    setup();
    writeFileSync(join(TMP, 'TALK.md'), '- Next owner: qa\n');
    const strictConfig = { ...CONFIG, rules: { strict_next_owner: true } };
    const result = resolveNextAgent(TMP, strictConfig, {});
    assert.equal(result.next, 'qa');
    assert.equal(result.source, 'talk');
    cleanup();
  });
});
