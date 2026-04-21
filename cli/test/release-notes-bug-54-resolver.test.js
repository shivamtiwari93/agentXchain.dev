import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const RELEASES_DIR = join(REPO_ROOT, 'website-v2/docs/releases');

function listReleaseNotes() {
  return readdirSync(RELEASES_DIR)
    .filter((name) => name.endsWith('.mdx'))
    .map((name) => join(RELEASES_DIR, name));
}

// DEC-BUG54-TESTER-RUNBOOKS-INSTALLED-PACKAGE-ONLY-001 (Turn 134) and
// DEC-BUG54-REPRO-RESOLVER-NPM-ROOT-FIRST-001 (Turn 133) require that every
// tester-facing reproduction command for `reproduce-bug-54.mjs` resolves the
// script from the installed `agentxchain` package via `npm root`, not from a
// repo-relative `cli/scripts/...` path. A tester reproducing in their own
// project worktree has no `cli/` directory and will hit ENOENT on the legacy
// form. This guard walks every public release notes page and fails if any one
// of them emits `node cli/scripts/reproduce-bug-54.mjs` as an executable
// command (prose references to the script path by name are permitted).
const REPO_RELATIVE_COMMAND = /node\s+cli\/scripts\/reproduce-bug-54\.mjs/;

describe('release notes BUG-54 repro resolver hygiene', () => {
  it('finds at least one release notes page to scan', () => {
    const pages = listReleaseNotes();
    assert.ok(pages.length > 0, 'release notes dir must contain at least one mdx');
  });

  it('does not tell the tester to run the repo-relative reproduce-bug-54 command', () => {
    const pages = listReleaseNotes();
    const offenders = [];
    for (const page of pages) {
      const text = readFileSync(page, 'utf8');
      if (REPO_RELATIVE_COMMAND.test(text)) {
        offenders.push(page.replace(`${REPO_ROOT}/`, ''));
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `release pages must use the \`$(npm root)/agentxchain/scripts/reproduce-bug-54.mjs\` resolver, ` +
        `never the repo-relative \`node cli/scripts/reproduce-bug-54.mjs\` form. Offending pages: ${offenders.join(', ')}`,
    );
  });

  it('each release page that reproduces BUG-54 includes the npm root resolver block', () => {
    const pages = listReleaseNotes();
    const required = /\$\(npm root(?:\s+-g)?\)\/agentxchain\/scripts\/reproduce-bug-54\.mjs/;
    // Only assert the positive resolver for pages that actually give tester
    // instructions (identified by presence of the script name followed by a
    // `--` flag, which is the executable-form marker). Pages that only
    // describe the script in prose are not required to carry the resolver.
    const executableFormMarker = /reproduce-bug-54\.mjs[^\n`]{0,200}--/;
    for (const page of pages) {
      const text = readFileSync(page, 'utf8');
      if (!executableFormMarker.test(text)) continue;
      assert.match(
        text,
        required,
        `${page.replace(`${REPO_ROOT}/`, '')} gives a BUG-54 reproduction command but is missing the npm root resolver block`,
      );
    }
  });
});
