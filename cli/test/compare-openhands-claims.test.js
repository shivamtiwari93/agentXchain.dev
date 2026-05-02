import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..', '..');
const page = readFileSync(resolve(root, 'website-v2/docs/compare/vs-openhands.mdx'), 'utf8');
const spec = readFileSync(resolve(root, '.planning/COMPARE_OPENHANDS_CLAIMS_SPEC.md'), 'utf8');
const matrix = readFileSync(resolve(root, '.planning/COMPETITIVE_POSITIONING_MATRIX.md'), 'utf8');

describe('OpenHands comparison claims truth boundary', () => {
  it('AT-OH-001: acknowledges composable SDK', () => {
    assert.match(page, /composable.*SDK|SDK.*composable/i, 'must acknowledge composable SDK');
  });

  it('AT-OH-002: acknowledges CLI product surface', () => {
    assert.match(page, /CLI/i, 'must acknowledge CLI');
  });

  it('AT-OH-003: acknowledges Cloud with RBAC', () => {
    assert.match(page, /Cloud.*RBAC|RBAC.*Cloud/i, 'must acknowledge Cloud RBAC');
  });

  it('AT-OH-004: acknowledges Enterprise Kubernetes deployment', () => {
    assert.match(page, /Enterprise.*Kubernetes|Kubernetes.*Enterprise/i, 'must acknowledge Enterprise K8s');
  });

  it('AT-OH-005: acknowledges Slack/Jira/Linear integrations', () => {
    assert.match(page, /Slack/i, 'must acknowledge Slack integration');
    assert.match(page, /Jira/i, 'must acknowledge Jira integration');
    assert.match(page, /Linear/i, 'must acknowledge Linear integration');
  });

  it('AT-OH-006: acknowledges Agent Server scaling', () => {
    assert.match(page, /Agent Server|thousands.*parallel/i, 'must acknowledge Agent Server or parallel scaling');
  });

  it('AT-OH-007: code example uses current SDK import path', () => {
    assert.match(page, /from openhands\.sdk import/i, 'code example must use current openhands.sdk import');
  });

  it('AT-OH-008: does not contain stale micro-agents term', () => {
    assert.doesNotMatch(page, /micro.agents/i, 'must not use stale "micro-agents" term');
  });

  it('AT-OH-010: governance posture row exists', () => {
    assert.match(page, /\| \*\*Governance posture\*\* \|/, 'must have governance posture row');
  });

  it('AT-OH-011: recovery posture row exists', () => {
    assert.match(page, /\| \*\*Recovery posture\*\* \|/, 'must have recovery posture row');
  });

  it('AT-OH-012: multi-repo posture row exists', () => {
    assert.match(page, /\| \*\*Multi-repo posture\*\* \|/, 'must have multi-repo posture row');
  });

  it('AT-OH-009: does not contain stale import path', () => {
    assert.doesNotMatch(page, /from openhands import Agent, Sandbox/, 'must not use stale openhands import');
  });

  it('AT-OH-013: exposes official source links and last-checked date', () => {
    assert.match(page, /Source baseline/, 'OpenHands page must expose the source baseline on-page');
    assert.match(page, /Last checked against official OpenHands sources on 2026-04-25/);
    for (const url of [
      'https://github.com/OpenHands/OpenHands',
      'https://github.com/OpenHands/software-agent-sdk/',
      'https://docs.openhands.dev/sdk',
      'https://docs.openhands.dev/sdk/arch/sdk',
      'https://docs.openhands.dev/sdk/arch/agent-server',
      'https://docs.openhands.dev/sdk/guides/agent-server/overview',
      'https://docs.openhands.dev/openhands/usage/cli/command-reference',
      'https://docs.openhands.dev/openhands/usage/cli/cloud',
      'https://docs.openhands.dev/enterprise',
      'https://docs.openhands.dev/openhands/usage/architecture/runtime',
      'https://github.com/OpenHands/benchmarks',
    ]) {
      assert.ok(page.includes(url), `OpenHands comparison page must link to ${url}`);
    }
    assert.match(spec, /AT-OH-013/);
    assert.match(matrix, /OpenHands row refreshed again on 2026-04-25/);
  });

  it('AT-OH-014: does not freeze unsupported exact benchmark score', () => {
    assert.doesNotMatch(page, /SWE-Bench 77\.6%/, 'must not freeze exact benchmark score without current official source');
    assert.doesNotMatch(spec, /SWE-Bench`\*\*: 77\.6%/, 'spec must not require stale exact score');
  });
});
