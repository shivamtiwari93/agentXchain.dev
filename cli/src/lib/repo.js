import { execSync } from 'child_process';

export async function getRepoUrl(root) {
  try {
    const raw = execSync('git remote get-url origin', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();

    // Convert SSH to HTTPS if needed
    // git@github.com:user/repo.git -> https://github.com/user/repo
    if (raw.startsWith('git@github.com:')) {
      const path = raw.replace('git@github.com:', '').replace(/\.git$/, '');
      return `https://github.com/${path}`;
    }

    // Strip embedded credentials/tokens from HTTPS URLs.
    // https://x-access-token:TOKEN@github.com/org/repo.git -> https://github.com/org/repo
    // https://user:pass@github.com/org/repo.git -> https://github.com/org/repo
    const credentialStripped = raw.replace(/^https?:\/\/[^/@]+@github\.com\//, 'https://github.com/');

    // Already HTTPS — strip .git suffix
    if (credentialStripped.includes('github.com')) {
      return credentialStripped.replace(/\.git$/, '');
    }

    return credentialStripped;
  } catch {
    return null;
  }
}

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
