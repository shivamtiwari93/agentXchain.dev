import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const ROOT_README = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');
const HOME_PAGE = readFileSync(join(REPO_ROOT, 'website', 'index.html'), 'utf8');
const WHY_PAGE = readFileSync(join(REPO_ROOT, 'website', 'why.html'), 'utf8');
const SHOW_HN_DRAFT = readFileSync(join(REPO_ROOT, '.planning', 'SHOW_HN_DRAFT.md'), 'utf8');
const POSITIONING_MATRIX = readFileSync(
  join(REPO_ROOT, '.planning', 'COMPETITIVE_POSITIONING_MATRIX.md'),
  'utf8'
);

describe('OpenAI positioning surfaces', () => {
  it('uses the OpenAI Agents SDK as the current OpenAI comparison target', () => {
    assert.ok(
      POSITIONING_MATRIX.includes('| **OpenAI Agents SDK** |'),
      'matrix must include an OpenAI Agents SDK row'
    );
    assert.ok(
      POSITIONING_MATRIX.includes('handoffs') || POSITIONING_MATRIX.includes('agents-as-tools'),
      'matrix must document OpenAI orchestration primitives'
    );
    assert.ok(
      POSITIONING_MATRIX.includes('human-in-the-loop') || POSITIONING_MATRIX.includes('Human-in-the-loop'),
      'matrix must document human-in-the-loop support'
    );
    assert.ok(
      POSITIONING_MATRIX.includes('Built-in tracing') || POSITIONING_MATRIX.includes('Tracing'),
      'matrix must document tracing support'
    );
    assert.ok(
      POSITIONING_MATRIX.includes('multi-provider'),
      'matrix must document official multi-provider support'
    );
  });

  it('keeps Swarm only as a deprecation note, not as a live comparison row', () => {
    assert.ok(
      !POSITIONING_MATRIX.includes('| **OpenAI Swarm** |'),
      'matrix must not keep a live OpenAI Swarm comparison row'
    );
    assert.ok(
      POSITIONING_MATRIX.includes('OpenAI Swarm README') &&
        POSITIONING_MATRIX.includes('deprecated'),
      'matrix should preserve the Swarm deprecation note'
    );
  });

  it('removes OpenAI Swarm from launch-facing comparison surfaces', () => {
    assert.ok(ROOT_README.includes('OpenAI Agents SDK'));

    for (const [label, content] of [
      ['README.md', ROOT_README],
      ['website/index.html', HOME_PAGE],
      ['website/why.html', WHY_PAGE],
      ['.planning/SHOW_HN_DRAFT.md', SHOW_HN_DRAFT]
    ]) {
      assert.ok(
        !content.includes('OpenAI Swarm'),
        `${label} must not present OpenAI Swarm as a current launch-facing comparison target`
      );
    }
  });
});
