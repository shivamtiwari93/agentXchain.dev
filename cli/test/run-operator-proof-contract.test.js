import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CLI_ROOT = join(import.meta.dirname, '..');
const REPO_ROOT = join(CLI_ROOT, '..');
const RUN_INTEGRATION_TEST = join(CLI_ROOT, 'test', 'run-integration.test.js');
const RUN_API_PROXY_INTEGRATION_TEST = join(CLI_ROOT, 'test', 'run-api-proxy-integration.test.js');
const CI_CLI_PROOF_CONTRACT_TEST = join(CLI_ROOT, 'test', 'ci-cli-auto-approve-proof-contract.test.js');
const RUN_SPEC = join(REPO_ROOT, '.planning', 'RUN_OPERATOR_PROOF_CONTRACT_SPEC.md');
const CI_WORKFLOW = join(REPO_ROOT, '.github', 'workflows', 'ci-runner-proof.yml');

describe('run operator proof inventory contract', () => {
  it('AT-RUN-PROOF-001: spec and guarded proof files exist', () => {
    for (const file of [
      RUN_SPEC,
      RUN_INTEGRATION_TEST,
      RUN_API_PROXY_INTEGRATION_TEST,
      CI_CLI_PROOF_CONTRACT_TEST,
      CI_WORKFLOW,
    ]) {
      assert.ok(existsSync(file), `expected file to exist: ${file}`);
    }
  });

  it('AT-RUN-PROOF-002: primary run integration shells out to the real CLI and proves completion artifacts', () => {
    const source = readFileSync(RUN_INTEGRATION_TEST, 'utf8');

    assert.match(source, /binPath = join\(cliRoot, 'bin', 'agentxchain\.js'\)/,
      'primary run integration must target cli/bin/agentxchain.js');
    assert.match(source, /spawnSync\(process\.execPath, \[binPath, \.\.\.args\]/,
      'primary run integration must shell out through spawnSync');
    assert.match(source, /\['run', '--auto-approve', '--max-turns', '5'\]/,
      'primary run integration must invoke agentxchain run --auto-approve');
    assert.match(source, /assert\.match\(result\.stdout, \/Run completed\//,
      'primary run integration must assert CLI-visible completion');
    assert.match(source, /state\.status, 'completed'/,
      'primary run integration must assert persisted completed state');
    assert.match(source, /history\.length >= 3/,
      'primary run integration must assert governed history persistence');
  });

  it('AT-RUN-PROOF-003: mixed-adapter run integration proves local_cli plus api_proxy through the CLI surface', () => {
    const source = readFileSync(RUN_API_PROXY_INTEGRATION_TEST, 'utf8');

    assert.match(source, /binPath = join\(cliRoot, 'bin', 'agentxchain\.js'\)/,
      'mixed-adapter run integration must target cli/bin/agentxchain.js');
    assert.match(source, /const result = await runCliAsync\(root, \['run', '--auto-approve', '--max-turns', '10'\]\)/,
      'mixed-adapter run integration must invoke agentxchain run via async subprocess');
    assert.match(source, /type: 'local_cli'/,
      'mixed-adapter run integration must include local_cli');
    assert.match(source, /type: 'api_proxy'/,
      'mixed-adapter run integration must include api_proxy');
    assert.match(source, /mock\.requestLog\.length >= 1/,
      'mixed-adapter run integration must assert api_proxy request receipt');
    assert.match(source, /state\.status, 'completed'/,
      'mixed-adapter run integration must assert persisted completed state');
  });

  it('AT-RUN-PROOF-004: CI retains a shell-out CLI proof for agentxchain run', () => {
    const proofContract = readFileSync(CI_CLI_PROOF_CONTRACT_TEST, 'utf8');
    const workflow = readFileSync(CI_WORKFLOW, 'utf8');

    assert.match(proofContract, /run-via-cli-auto-approve\.mjs/,
      'CLI proof contract must guard the CLI auto-approve proof script');
    assert.match(proofContract, /shells out to the real agentxchain CLI binary/i,
      'CLI proof contract must explicitly guard the shell-out boundary');
    assert.match(workflow, /run-via-cli-auto-approve\.mjs/,
      'CI workflow must execute the CLI auto-approve proof');
    assert.match(workflow, /ANTHROPIC_API_KEY/,
      'CI workflow must preserve the auth env for the CLI proof');
  });
});
