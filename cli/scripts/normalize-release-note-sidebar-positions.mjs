#!/usr/bin/env node

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const releasesDir = join(repoRoot, 'website-v2', 'docs', 'releases');

function parseReleaseFile(file) {
  const match = /^v(\d+)-(\d+)-(\d+)\.mdx$/.exec(file);
  if (!match) {
    throw new Error(`Unparseable release note filename: ${file}`);
  }
  return {
    file,
    version: match.slice(1).map(Number),
  };
}

function compareDesc(left, right) {
  for (let i = 0; i < 3; i += 1) {
    if (left.version[i] !== right.version[i]) {
      return right.version[i] - left.version[i];
    }
  }
  return 0;
}

function updateSidebarPosition(content, nextPosition) {
  if (!content.startsWith('---\n')) {
    throw new Error('Release note is missing YAML frontmatter opening delimiter');
  }

  const frontmatterEnd = content.indexOf('\n---\n', 4);
  if (frontmatterEnd === -1) {
    throw new Error('Release note is missing YAML frontmatter closing delimiter');
  }

  const frontmatter = content.slice(0, frontmatterEnd + 5);
  const body = content.slice(frontmatterEnd + 5);
  const expectedLine = `sidebar_position: ${nextPosition}`;

  // Strip ALL existing sidebar_position lines (handles duplicates from manual edits)
  let strippedFrontmatter = frontmatter.replace(/^sidebar_position:\s*-?\d+\s*\n/gm, '');
  // Insert the canonical position after the opening delimiter
  let updatedFrontmatter = strippedFrontmatter.replace(/^---\n/, `---\n${expectedLine}\n`);

  const updated = updatedFrontmatter + body;
  return {
    updated,
    changed: updated !== content,
  };
}

const releaseFiles = readdirSync(releasesDir)
  .filter((file) => /^v\d+-\d+-\d+\.mdx$/.test(file))
  .map(parseReleaseFile)
  .sort(compareDesc);

if (releaseFiles.length === 0) {
  throw new Error(`No release notes found in ${releasesDir}`);
}

let changedCount = 0;
for (const [index, release] of releaseFiles.entries()) {
  const filePath = join(releasesDir, release.file);
  const content = readFileSync(filePath, 'utf8');
  const { updated, changed } = updateSidebarPosition(content, index);
  if (changed) {
    writeFileSync(filePath, updated);
    changedCount += 1;
  }
}

console.log(
  `Normalized release note sidebar positions across ${releaseFiles.length} files (${changedCount} updated).`,
);
