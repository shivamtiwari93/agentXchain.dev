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

const ROOT_README = read('README.md');
const CLI_README = read('cli/README.md');
const HOMEPAGE = read('website-v2/src/pages/index.tsx');
const QUICKSTART = read('website-v2/docs/quickstart.mdx');
const GETTING_STARTED = read('website-v2/docs/getting-started.mdx');
const SPEC = read('.planning/FRONTDOOR_GOVERNED_READY_PATH_SPEC.md');

describe('front-door governed-ready path', () => {
  it('AT-FDGR-001: repo and npm READMEs route quick start through --goal, doctor, and config-based goal recovery', () => {
    for (const [label, content] of [
      ['README.md', ROOT_README],
      ['cli/README.md', CLI_README],
    ]) {
      assert.match(content, /agentxchain init --governed --goal/, `${label} must show --goal in the primary scaffold path`);
      assert.match(content, /agentxchain doctor/, `${label} must route operators through doctor before the first turn`);
      assert.match(content, /agentxchain config --set project\.goal/, `${label} must show config-based goal recovery instead of manual JSON editing`);
    }
  });

  it('AT-FDGR-002: homepage terminal sample matches the governed-ready path', () => {
    assert.match(HOMEPAGE, /agentxchain init --governed --goal/);
    assert.match(HOMEPAGE, /agentxchain doctor/);
  });

  it('AT-FDGR-003: quickstart and getting-started use --goal plus doctor in the primary bootstrap flow', () => {
    for (const [label, content] of [
      ['quickstart', QUICKSTART],
      ['getting-started', GETTING_STARTED],
    ]) {
      assert.match(content, /agentxchain init --governed[\s\S]{0,120}--goal/, `${label} must show --goal in the bootstrap command`);
      assert.match(content, /agentxchain doctor/, `${label} must include doctor before the first governed turn`);
    }
  });

  it('AT-FDGR-004: getting-started does not teach in-place goal-setting re-init after scaffold', () => {
    assert.doesNotMatch(
      GETTING_STARTED,
      /agentxchain init --governed --template cli-tool --goal "Build a CLI that lints decision logs" --dir \. -y[\s\S]*agentxchain init --governed --template cli-tool --goal "Build a CLI that lints decision logs" --dir \. -y/,
      'getting-started must not show a second in-place init --goal flow after scaffold',
    );
    assert.match(GETTING_STARTED, /Do not re-run `init --governed` in place just to add the goal\./);
  });
});

describe('front-door governed-ready path spec', () => {
  it('records the contract and acceptance tests', () => {
    assert.match(SPEC, /## Purpose/);
    assert.match(SPEC, /## Interface/);
    assert.match(SPEC, /## Behavior/);
    assert.match(SPEC, /## Acceptance Tests/);
    assert.match(SPEC, /AT-FDGR-001/);
    assert.match(SPEC, /AT-FDGR-004/);
  });
});
