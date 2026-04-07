import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

describe('governed init local runtime docs contract', () => {
  const cliDocs = read('website-v2/docs/cli.mdx');
  const quickstartDocs = read('website-v2/docs/quickstart.mdx');
  const rootReadme = read('README.md');
  const cliReadme = read('cli/README.md');
  const cliEntry = read('cli/bin/agentxchain.js');
  const startCommand = read('cli/src/commands/start.js');
  const governedExampleReadme = read('examples/governed-todo-app/README.md');
  const governedExampleConfig = JSON.parse(read('examples/governed-todo-app/agentxchain.json'));
  const governedExamplePmSignoff = read('examples/governed-todo-app/.planning/PM_SIGNOFF.md');

  it('CLI registers the governed init local runtime flags', () => {
    assert.match(cliEntry, /--dir <path>/, 'CLI must register --dir');
    assert.match(cliEntry, /--dev-command <parts\.\.\.>/, 'CLI must register --dev-command');
    assert.match(cliEntry, /--dev-prompt-transport <mode>/, 'CLI must register --dev-prompt-transport');
  });

  it('CLI docs document the governed init local runtime flags', () => {
    assert.match(cliDocs, /`--dir <path>`/, 'CLI docs must mention --dir');
    assert.match(cliDocs, /`--dev-command <parts\.\.\.>`/, 'CLI docs must mention --dev-command');
    assert.match(cliDocs, /`--dev-prompt-transport <mode>`/, 'CLI docs must mention --dev-prompt-transport');
  });

  it('CLI docs document the prompt placeholder contract', () => {
    assert.match(cliDocs, /\{prompt\}/, 'CLI docs must mention the {prompt} placeholder');
    assert.match(cliDocs, /argv.*requires.*\{prompt\}|requires.*\{prompt\}.*argv/i,
      'CLI docs must explain that argv mode requires {prompt}');
    assert.match(cliDocs, /stdin.*must not include.*\{prompt\}|dispatch_bundle_only.*must not include.*\{prompt\}/i,
      'CLI docs must explain that non-argv modes must not include {prompt}');
  });

  it('quickstart documents the scaffold-time override path', () => {
    assert.match(quickstartDocs, /--dir \./, 'quickstart must document --dir . for in-place bootstrap');
    assert.match(quickstartDocs, /--dev-command/, 'quickstart must mention --dev-command');
    assert.match(quickstartDocs, /claude --print --dangerously-skip-permissions/,
      'quickstart must state the unattended default Claude command');
  });

  it('front-door READMEs mention the scaffold-time local runtime override', () => {
    assert.match(rootReadme, /--dir my-agentxchain-project/, 'root README must show explicit --dir usage');
    assert.match(cliReadme, /--dir my-agentxchain-project/, 'CLI README must show explicit --dir usage');
    assert.match(rootReadme, /--dev-command/, 'root README must mention --dev-command');
    assert.match(cliReadme, /--dev-command/, 'CLI README must mention --dev-command');
    assert.match(rootReadme, /claude --print --dangerously-skip-permissions/,
      'root README must describe the unattended default Claude command truthfully');
    assert.match(cliReadme, /claude --print --dangerously-skip-permissions/,
      'CLI README must describe the unattended default Claude command truthfully');
  });

  it('governed todo example uses the same unattended Claude runtime contract', () => {
    assert.deepEqual(
      governedExampleConfig.runtimes['local-dev'].command,
      ['claude', '--print', '--dangerously-skip-permissions'],
      'governed example must use the unattended Claude command',
    );
    assert.equal(
      governedExampleConfig.runtimes['local-dev'].prompt_transport,
      'stdin',
      'governed example must use stdin prompt delivery',
    );
    assert.match(
      governedExampleReadme,
      /claude --print --dangerously-skip-permissions/,
      'governed example README must describe the same unattended Claude command',
    );
    assert.match(
      governedExampleReadme,
      /Do not list raw non-zero negative-case commands on a passing turn|verification\.machine_evidence.*exit_code.*0/i,
      'governed example README must describe the expected-failure verification contract',
    );
    assert.match(
      quickstartDocs,
      /Do not list raw non-zero negative-case commands on a passing turn|machine_evidence.*command exits `0`/i,
      'quickstart must describe the expected-failure verification contract',
    );
  });

  it('front-door docs tell the truth about default api_proxy QA', () => {
    assert.match(
      rootReadme,
      /cannot directly write .*acceptance-matrix\.md.*ship-verdict\.md.*RELEASE_NOTES\.md/i,
      'root README must explain that default api_proxy QA does not directly author QA gate files',
    );
    assert.match(
      quickstartDocs,
      /\.agentxchain\/reviews\/|does \*\*not\*\* mean the QA gate files were rewritten automatically/i,
      'quickstart must describe the review artifact path and non-writing api_proxy truth',
    );
    assert.match(
      governedExampleReadme,
      /cannot directly edit \.planning\/acceptance-matrix\.md|switch the QA runtime to `manual`/i,
      'governed example README must explain how to handle QA gate files truthfully',
    );
  });

  it('front-door docs and scaffold explain the PM signoff gate semantics explicitly', () => {
    assert.match(
      governedExampleReadme,
      /Approved: NO" to "Approved: YES"|Approved: NO -> Approved: YES/i,
      'governed example README must tell operators to flip the PM signoff marker explicitly',
    );
    assert.match(
      governedExamplePmSignoff,
      /starts blocked on purpose/i,
      'governed example PM signoff must explain that the blocked default is intentional',
    );
    assert.match(
      governedExamplePmSignoff,
      /Approved: YES/,
      'governed example PM signoff must name the exact marker operators need',
    );
    assert.match(
      quickstartDocs,
      /A fresh scaffold starts with `PM_SIGNOFF\.md` set to `Approved: NO`/i,
      'quickstart must state that fresh scaffolds begin blocked at Approved: NO',
    );
    assert.match(
      rootReadme,
      /Approved: NO -> Approved: YES/,
      'root README lifecycle snippet must tell operators to flip the PM signoff marker explicitly',
    );
    assert.match(
      startCommand,
      /Fresh governed scaffolds start at `Approved: NO`.*`Approved: YES`/s,
      'start command guidance must explain the blocked default and the required signoff flip',
    );
  });

  // --- Overclaiming guards (DEC-DOCS-OVERCLAIM-001) ---

  const adaptersDocs = read('website-v2/docs/adapters.mdx');
  const whyPage = read('website-v2/src/pages/why.mdx');

  it('adapters page does not claim equal first-class support for Codex or Aider', () => {
    // The comparison table and "Best for" row should not list bare "Codex, Aider" as peers
    assert.doesNotMatch(adaptersDocs, /Best for.*Codex, Aider/,
      'adapters comparison table must not list Codex and Aider as equal peers to Claude');
  });

  it('adapters page positions Claude as verified default in local_cli section', () => {
    assert.match(adaptersDocs, /Claude Code.*default|default.*Claude Code/i,
      'adapters local_cli section must identify Claude Code as the verified default');
  });

  it('adapters page documents non-default local CLI examples', () => {
    assert.match(adaptersDocs, /Non-default local CLI examples/,
      'adapters page must include the non-default local CLI examples section');
    assert.match(adaptersDocs, /dispatch_bundle_only/,
      'adapters page must show dispatch_bundle_only example');
    assert.match(adaptersDocs, /my-agent run \{prompt\}/,
      'adapters page must show argv example with {prompt} placeholder');
  });

  it('why page does not overclaim adapter support', () => {
    assert.doesNotMatch(whyPage, /spawns Claude Code, Codex, Aider/,
      'why page must not list Claude Code, Codex, Aider as equal peers');
    assert.match(whyPage, /--dev-command/,
      'why page must reference --dev-command for non-default tools');
  });

  // --- Template page scaffold path guard (DEC-DOCS-SCAFFOLD-PATH-001) ---

  const templatesDocs = read('website-v2/docs/templates.mdx');

  it('templates page uses explicit --dir in init examples', () => {
    assert.match(templatesDocs, /--dir/, 'templates page must use explicit --dir in init examples');
    assert.doesNotMatch(templatesDocs, /init --governed --template \w+ -y\n/,
      'templates page must not use -y without --dir');
  });
});
