/**
 * Git helpers for CI proof scripts.
 * Proof scripts create temp directories that need to be proper git repos
 * so the repo-observer can detect file changes across turns.
 */

import { execSync } from 'child_process';

export function gitInit(root) {
  execSync('git init && git add -A && git commit -m "scaffold"', { cwd: root, stdio: 'ignore' });
}

export function gitCommitAll(root) {
  try { execSync('git add -A && git commit -m "post-turn"', { cwd: root, stdio: 'ignore' }); } catch {}
}
