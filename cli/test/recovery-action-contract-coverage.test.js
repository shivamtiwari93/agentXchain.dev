import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');

function walkFiles(startDir, includeExts, exclude = () => false) {
  const out = [];
  function visit(absPath) {
    if (exclude(absPath)) {
      return;
    }
    const stat = statSync(absPath);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(absPath)) {
        visit(join(absPath, entry));
      }
      return;
    }
    if (includeExts.some((ext) => absPath.endsWith(ext))) {
      out.push(absPath);
    }
  }
  visit(startDir);
  return out;
}

function toRel(absPath) {
  return relative(ROOT, absPath).replaceAll('\\', '/');
}

function read(absPath) {
  return readFileSync(absPath, 'utf8');
}

const DOC_FILES = walkFiles(join(ROOT, 'website-v2', 'docs'), ['.mdx']);
const PLANNING_FILES = walkFiles(
  join(ROOT, '.planning'),
  ['.md'],
  (absPath) => {
    const rel = toRel(absPath);
    return rel.endsWith('AGENT-TALK.md') || rel.includes('ARCHIVE');
  },
);
const TARGET_FILES = [...DOC_FILES, ...PLANNING_FILES, join(ROOT, 'cli', 'CHANGELOG.md')];

const BANNED_EXACT = [
  /Resolve the blocker explicitly with `agentxchain unblock <id>`/i,
  /After `agentxchain unblock <id>`, the daemon continues the same schedule-owned run/i,
];

const SCHEDULE_OR_CONTINUOUS_CONTEXT = /(schedule|daemon|continuous|blocked session|schedule-owned)/i;
const CONTRACT_TOKENS = /(recovery_action|blocked_category|reissue-turn --reason ghost|reissue-turn --reason stale|needs_human)/i;
const NEGATIVE_META_CONTEXT = /(hard-code|hard-codes|banned|fail the content test|regress|universal)/i;

function surroundingWindow(lines, index, radius = 3) {
  const start = Math.max(0, index - radius);
  const end = Math.min(lines.length, index + radius + 1);
  return lines.slice(start, end).join('\n');
}

describe('recovery action contract coverage', () => {
  it('bans known universal-unblock phrases across operator docs, planning specs, and changelog', () => {
    const failures = [];
    for (const file of TARGET_FILES) {
      const content = read(file);
      for (const pattern of BANNED_EXACT) {
        if (pattern.test(content)) {
          failures.push(`${toRel(file)} matched banned phrase ${pattern}`);
        }
      }
    }
    assert.deepEqual(
      failures,
      [],
      `universal-unblock phrasing regressed:\n${failures.join('\n')}`,
    );
  });

  it('requires BUG-47/51 contract tokens when schedule or continuous docs mention unblock as recovery', () => {
    const failures = [];
    for (const file of TARGET_FILES) {
      const lines = read(file).split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        if (!lines[i].includes('agentxchain unblock <id>')) {
          continue;
        }
        const window = surroundingWindow(lines, i);
        if (!SCHEDULE_OR_CONTINUOUS_CONTEXT.test(window)) {
          continue;
        }
        if (NEGATIVE_META_CONTEXT.test(window)) {
          continue;
        }
        if (!CONTRACT_TOKENS.test(window)) {
          failures.push(
            `${toRel(file)}:${i + 1} mentions unblock in schedule/continuous recovery context without recovery_action/blocked_category/ghost|stale scoping`,
          );
        }
      }
    }
    assert.deepEqual(
      failures,
      [],
      `schedule/continuous recovery docs regressed to universal unblock:\n${failures.join('\n')}`,
    );
  });
});
