/**
 * Git helpers for test fixtures.
 * Test temp directories need to be proper git repos so the repo-observer
 * can detect file changes across turns.
 */

import { execSync } from 'child_process';

const TEST_GIT_NAME = 'AgentXchain Test Helper';
const TEST_GIT_EMAIL = 'agentxchain-tests@example.invalid';

function git(cmd, root) {
  execSync(cmd, { cwd: root, stdio: 'ignore' });
}

export function gitInit(root) {
  git('git init', root);
  git(`git config user.name "${TEST_GIT_NAME}"`, root);
  git(`git config user.email "${TEST_GIT_EMAIL}"`, root);
  git('git add -A', root);
  git('git commit --allow-empty -m "scaffold"', root);
}

export function gitCommitAll(root) {
  try {
    git('git add -A', root);
    git('git commit -m "post-turn"', root);
  } catch {}
}
