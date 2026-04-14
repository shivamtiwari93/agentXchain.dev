import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function read(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

const QUICKSTART = read('website-v2/docs/quickstart.mdx');

describe('quickstart single-repo content contract', () => {
  it('Path 1 uses step without --role pm (entry role is implicit)', () => {
    // Path 1 code block should show `agentxchain step` not `step --role pm`
    // The planning-phase entry role is pm by default
    assert.match(QUICKSTART, /agentxchain step\n/);
  });

  it('documents that step auto-validates and auto-accepts', () => {
    assert.match(QUICKSTART, /auto-validates/i);
    assert.match(QUICKSTART, /auto-accepts/i);
  });

  it('does not show accept-turn as a mandatory step after step completes', () => {
    // accept-turn should only appear in the Ctrl+C fallback path, not as the primary flow
    // The primary flow should be: step (blocks, auto-accepts) -> approve-transition
    const sections = QUICKSTART.split('## Manual path');
    const manualSection = sections[1] || '';
    // In the manual path, accept-turn should only appear after mentioning Ctrl+C
    const beforeCtrlC = manualSection.split(/[Cc]trl\+C|ctrl-c/)[0] || '';
    // The primary "Approve the phase transition" section should NOT have accept-turn
    const approveSection = beforeCtrlC.match(/### 3\. Approve.*?(?=###|$)/s)?.[0] || '';
    assert.doesNotMatch(approveSection, /agentxchain accept-turn/,
      'Primary manual flow should not show accept-turn (step already accepted)');
  });

  it('documents the Ctrl+C manual fallback with accept-turn', () => {
    assert.match(QUICKSTART, /[Cc]trl\+C/);
    assert.match(QUICKSTART, /accept-turn/);
  });

  it('documents the dispatch bundle files correctly', () => {
    assert.match(QUICKSTART, /ASSIGNMENT\.json/);
    assert.match(QUICKSTART, /dispatch bundle/i);
  });

  it('documents the four adapter types', () => {
    for (const adapter of ['manual', 'local_cli', 'mcp', 'api_proxy']) {
      assert.match(QUICKSTART, new RegExp(`\`${adapter}\``));
    }
  });

  it('documents the automated path with run', () => {
    assert.match(QUICKSTART, /agentxchain run --auto-approve --max-turns 10/);
    assert.match(QUICKSTART, /--dry-run/);
  });

  it('documents the three scaffold gate files correctly', () => {
    assert.match(QUICKSTART, /PM_SIGNOFF\.md/);
    assert.match(QUICKSTART, /ROADMAP\.md/);
    assert.match(QUICKSTART, /SYSTEM_SPEC\.md/);
    assert.match(QUICKSTART, /IMPLEMENTATION_NOTES\.md/);
    assert.match(QUICKSTART, /acceptance-matrix\.md/);
    assert.match(QUICKSTART, /ship-verdict\.md/);
    assert.match(QUICKSTART, /RELEASE_NOTES\.md/);
  });

  it('documents the generic default runtime bindings truthfully and distinguishes mixed-mode templates', () => {
    assert.match(QUICKSTART, /manual-pm/);
    assert.match(QUICKSTART, /manual-dev/);
    assert.match(QUICKSTART, /manual-qa/);
    assert.match(QUICKSTART, /local-dev/);
    assert.match(QUICKSTART, /api-qa/);
  });

  it('documents the dev runtime default command', () => {
    assert.match(QUICKSTART, /claude.*--print.*--dangerously-skip-permissions/);
  });

  it('documents approve-transition and approve-completion as constitutional gates', () => {
    assert.match(QUICKSTART, /approve-transition/);
    assert.match(QUICKSTART, /approve-completion/);
    assert.match(QUICKSTART, /constitutional/i);
  });

  it('documents template validate as scaffold proof', () => {
    assert.match(QUICKSTART, /agentxchain template validate/);
    assert.match(QUICKSTART, /scaffold proof.*not gate proof/i);
  });

  it('contains no TODO placeholders in user-facing content', () => {
    // JSON examples should use "turn_..." not "TODO" for placeholder IDs
    assert.doesNotMatch(QUICKSTART, /"TODO"/,
      'Public docs must not contain "TODO" placeholders — use realistic placeholder values');
  });

  it('documents the events command for observability', () => {
    assert.match(QUICKSTART, /events|event/i);
  });

  it('documents doctor as a readiness check before the first turn', () => {
    assert.match(QUICKSTART, /agentxchain doctor/,
      'Quickstart must introduce doctor between scaffold validation and first turn');
  });

  it('documents config --set for omitted project-goal recovery', () => {
    assert.match(QUICKSTART, /agentxchain config --set project\.goal/,
      'Quickstart must route omitted-goal recovery through config --set');
  });
});
