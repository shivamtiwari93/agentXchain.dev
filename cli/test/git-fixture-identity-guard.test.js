import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = join(__dirname, '..', '..');
const TARGET_PATHS = [
  join(CLI_ROOT, 'cli', 'test'),
  join(CLI_ROOT, 'cli', 'test-support'),
  join(CLI_ROOT, 'examples', 'ci-runner-proof'),
  join(CLI_ROOT, 'cli', 'src', 'commands', 'demo.js'),
];
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs']);
const IDENTITY_MARKERS = [
  'git config user.email',
  'git config user.name',
  'gitInit(',
];

describe('git fixture identity guard', () => {
  it('requires fixture-local git identity markers wherever targeted proof code commits', () => {
    const offenders = [];

    for (const path of TARGET_PATHS) {
      for (const file of collectSourceFiles(path)) {
        const content = readFileSync(file, 'utf8');
        if (!hasRealGitCommit(content)) continue;
        if (IDENTITY_MARKERS.some((marker) => content.includes(marker))) continue;
        offenders.push(relative(CLI_ROOT, file));
      }
    }

    assert.deepStrictEqual(
      offenders,
      [],
      [
        'Files with git-backed proof commits must configure local git identity or call gitInit(...).',
        ...offenders.map((file) => `- ${file}`),
      ].join('\n'),
    );
  });
});

function collectSourceFiles(path) {
  const stats = statSync(path);
  if (stats.isFile()) {
    return SOURCE_EXTENSIONS.has(getExtension(path)) ? [path] : [];
  }

  const files = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const fullPath = join(path, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }
    if (SOURCE_EXTENSIONS.has(getExtension(fullPath))) {
      files.push(fullPath);
    }
  }
  return files;
}

function getExtension(path) {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? '' : path.slice(dot);
}

function hasRealGitCommit(content) {
  return content
    .split('\n')
    .some((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('#')) {
        return false;
      }
      return trimmed.includes('git commit');
    });
}
