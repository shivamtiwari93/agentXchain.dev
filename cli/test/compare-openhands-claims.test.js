import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(resolve(__dirname, '../../website-v2/src/pages/compare/vs-openhands.mdx'), 'utf8');

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

  it('AT-OH-009: does not contain stale import path', () => {
    assert.doesNotMatch(page, /from openhands import Agent, Sandbox/, 'must not use stale openhands import');
  });
});
