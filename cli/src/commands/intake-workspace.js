import chalk from 'chalk';
import { existsSync, readFileSync } from 'node:fs';
import { join, parse as pathParse, resolve } from 'node:path';
import { findProjectRoot } from '../lib/config.js';
import { COORDINATOR_CONFIG_FILE } from '../lib/coordinator-config.js';

function findCoordinatorWorkspaceRoot(startDir = process.cwd()) {
  let dir = resolve(startDir);
  const { root: fsRoot } = pathParse(dir);

  while (true) {
    if (existsSync(join(dir, COORDINATOR_CONFIG_FILE))) {
      return dir;
    }
    if (dir === fsRoot) {
      return null;
    }
    dir = join(dir, '..');
  }
}

function listCoordinatorChildRepos(coordinatorRoot) {
  const configPath = join(coordinatorRoot, COORDINATOR_CONFIG_FILE);
  if (!existsSync(configPath)) {
    return [];
  }

  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf8'));
    return Object.keys(raw?.repos || {});
  } catch {
    return [];
  }
}

export function requireIntakeWorkspaceOrExit(opts, startDir = process.cwd()) {
  const projectRoot = findProjectRoot(startDir);
  if (projectRoot) {
    return projectRoot;
  }

  const coordinatorRoot = findCoordinatorWorkspaceRoot(startDir);
  const childRepos = coordinatorRoot ? listCoordinatorChildRepos(coordinatorRoot) : [];
  const repoHint = childRepos.length > 0
    ? ` Available child repos: ${childRepos.join(', ')}.`
    : '';
  const error = coordinatorRoot
    ? `intake commands are repo-local only. Found coordinator workspace at ${coordinatorRoot} (${COORDINATOR_CONFIG_FILE}). Run intake inside a child governed repo (agentxchain.json).${repoHint} Then use \`agentxchain multi step\` for cross-repo coordination.`
    : 'agentxchain.json not found';

  if (opts.json) {
    console.log(JSON.stringify({ ok: false, error }, null, 2));
  } else {
    console.log(chalk.red(error));
  }

  process.exit(2);
}
