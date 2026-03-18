import { execSync } from 'child_process';

export async function getRepoUrl(root) {
  try {
    const raw = execSync('git remote get-url origin', { cwd: root, encoding: 'utf8' }).trim();

    // Convert SSH to HTTPS if needed
    // git@github.com:user/repo.git -> https://github.com/user/repo
    if (raw.startsWith('git@github.com:')) {
      const path = raw.replace('git@github.com:', '').replace(/\.git$/, '');
      return `https://github.com/${path}`;
    }

    // Already HTTPS — strip .git suffix
    if (raw.includes('github.com')) {
      return raw.replace(/\.git$/, '');
    }

    // Strip tokens from URL (x-access-token:TOKEN@github.com)
    if (raw.includes('x-access-token')) {
      const cleaned = raw.replace(/https:\/\/x-access-token:[^@]+@/, 'https://');
      return cleaned.replace(/\.git$/, '');
    }

    return raw;
  } catch {
    return null;
  }
}

export function getCurrentBranch(root) {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'main';
  }
}
