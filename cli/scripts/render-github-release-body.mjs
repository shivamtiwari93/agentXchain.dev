#!/usr/bin/env node

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

function usage() {
  console.error('Usage: node scripts/render-github-release-body.mjs --target-version <semver> [--repo <owner/name>]');
}

function parseArgs(argv) {
  let targetVersion = '';
  let repo = process.env.GITHUB_REPOSITORY || 'shivamtiwari93/agentXchain.dev';

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--target-version') {
      targetVersion = argv[i + 1] || '';
      i += 1;
      continue;
    }
    if (arg === '--repo') {
      repo = argv[i + 1] || '';
      i += 1;
      continue;
    }
    usage();
    process.exit(1);
  }

  if (!/^\d+\.\d+\.\d+$/.test(targetVersion)) {
    usage();
    process.exit(1);
  }

  return { targetVersion, repo };
}

function stripFrontmatter(text) {
  return text.replace(/^---\n[\s\S]*?\n---\n*/, '').trim();
}

function extractSummaryParagraph(text, version) {
  const heading = `# AgentXchain v${version}`;
  const headingIndex = text.indexOf(heading);
  if (headingIndex === -1) {
    throw new Error(`Release heading missing from governed release page for ${version}`);
  }

  const afterHeading = text.slice(headingIndex + heading.length).trimStart();
  const summaryMatch = afterHeading.match(/^([^\n#][\s\S]*?)\n\s*\n/);
  if (!summaryMatch) {
    throw new Error(`Release summary paragraph missing from governed release page for ${version}`);
  }

  return summaryMatch[1].replace(/\s+/g, ' ').trim();
}

function extractAggregateEvidenceLine(text) {
  const matches = [...text.matchAll(/^-\s+.*\b(\d+)\s+tests\b.*\b0 failures\b.*$/gm)];
  if (matches.length === 0) {
    throw new Error('Concrete aggregate evidence line missing from governed release page');
  }

  const aggregate = matches.reduce((best, match) => {
    const count = Number(match[1]);
    if (!best || count > best.count) {
      return { count, line: match[0] };
    }
    return best;
  }, null);

  return aggregate.line.replace(/\*\*/g, '').replace(/`/g, '').replace(/,/g, '').trim();
}

function getPreviousVersionTag(repoRoot, version) {
  const currentTag = `v${version}`;
  const output = execFileSync(
    'git',
    ['tag', '--list', 'v*.*.*', '--sort=-v:refname'],
    { cwd: repoRoot, encoding: 'utf8' },
  );

  const tags = output.split('\n').map((line) => line.trim()).filter(Boolean);
  const currentIndex = tags.indexOf(currentTag);
  if (currentIndex === -1 || currentIndex === tags.length - 1) {
    return null;
  }
  return tags[currentIndex + 1];
}

function renderBody({ version, repo, summary, evidence, previousTag }) {
  const docsUrl = `https://agentxchain.dev/docs/releases/v${version.replace(/\./g, '-')}`;
  const npmUrl = `https://www.npmjs.com/package/agentxchain/v/${version}`;
  const lines = [
    `Public release notes: ${docsUrl}`,
    `npm package: ${npmUrl}`,
    '',
    summary,
    '',
    '## Evidence',
    evidence,
  ];

  if (previousTag) {
    lines.push('', `Full Changelog: https://github.com/${repo}/compare/${previousTag}...v${version}`);
  }

  return `${lines.join('\n')}\n`;
}

function main() {
  const { targetVersion, repo } = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(import.meta.dirname, '..', '..');
  const releaseDocPath = resolve(
    repoRoot,
    'website-v2',
    'docs',
    'releases',
    `v${targetVersion.replace(/\./g, '-')}.mdx`,
  );

  if (!existsSync(releaseDocPath)) {
    throw new Error(`Governed release page missing: ${releaseDocPath}`);
  }

  const rawDoc = readFileSync(releaseDocPath, 'utf8');
  const doc = stripFrontmatter(rawDoc);
  const summary = extractSummaryParagraph(doc, targetVersion);
  const evidence = extractAggregateEvidenceLine(doc);
  const previousTag = getPreviousVersionTag(repoRoot, targetVersion);
  process.stdout.write(
    renderBody({
      version: targetVersion,
      repo,
      summary,
      evidence,
      previousTag,
    }),
  );
}

main();
