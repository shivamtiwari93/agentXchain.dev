import { execSync } from 'child_process';

export function getCurrentBranch(root) {
  try {
    const current = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    if (current && current !== 'HEAD') return current;
  } catch {}

  try {
    const remoteHead = execSync('git symbolic-ref --short refs/remotes/origin/HEAD', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    if (remoteHead.includes('/')) return remoteHead.split('/').pop();
  } catch {
    return 'main';
  }

  return 'main';
}
