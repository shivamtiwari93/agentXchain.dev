import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const RELEASE_ALIGNMENT_SCOPES = {
  PREBUMP: 'prebump',
  CURRENT: 'current',
};

function read(repoRoot, relativePath) {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function readJson(repoRoot, relativePath) {
  return JSON.parse(read(repoRoot, relativePath));
}

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function formatCount(value) {
  return new Intl.NumberFormat('en-US').format(value);
}

function normalizeEvidenceText(value) {
  return value
    .replace(/^\s*-\s*/, '')
    .replace(/\.$/, '')
    .replace(/,/g, '')
    .trim();
}

export function extractTopReleaseSection(changelog, version) {
  const heading = `## ${version}`;
  const start = changelog.indexOf(heading);
  if (start === -1) {
    return null;
  }
  const afterStart = changelog.slice(start + heading.length);
  const nextHeadingOffset = afterStart.search(/\n##\s+\d+\.\d+\.\d+/);
  return nextHeadingOffset === -1 ? afterStart : afterStart.slice(0, nextHeadingOffset);
}

export function extractAggregateEvidenceLine(text) {
  const matches = [...text.matchAll(/(^-\s+.*\b\d[\d,]*\s+tests\b.*\b0 failures\b.*$)/gm)];
  if (matches.length === 0) {
    return null;
  }

  const aggregate = matches.reduce((best, match) => {
    const line = match[1].replace(/\*\*/g, '').replace(/`/g, '').trim();
    const countMatch = line.match(/\b(\d[\d,]*)\s+tests\b/);
    const count = countMatch ? Number(countMatch[1].replace(/,/g, '')) : 0;
    if (!best || count > best.count) {
      return { count, line };
    }
    return best;
  }, null);

  return aggregate?.line ?? null;
}

function extractAggregateEvidenceCount(line) {
  const match = line?.match(/\b(\d[\d,]*)\s+tests\b/);
  if (!match) {
    return null;
  }
  return Number(match[1].replace(/,/g, ''));
}

export function getReleaseAlignmentContext(repoRoot, { targetVersion } = {}) {
  const pkg = readJson(repoRoot, 'cli/package.json');
  const version = targetVersion || pkg.version;
  const releaseDocId = `v${version.replace(/\./g, '-')}`;
  const releaseDocPath = `website-v2/docs/releases/${releaseDocId}.mdx`;
  const releaseRoute = `/docs/releases/${releaseDocId}`;
  const tarballUrl = `https://registry.npmjs.org/agentxchain/-/agentxchain-${version}.tgz`;
  const changelog = read(repoRoot, 'cli/CHANGELOG.md');
  const changelogSection = extractTopReleaseSection(changelog, version);
  const aggregateEvidenceLine = changelogSection ? extractAggregateEvidenceLine(changelogSection) : null;
  const aggregateEvidenceCount = extractAggregateEvidenceCount(aggregateEvidenceLine);

  return {
    packageVersion: pkg.version,
    targetVersion: version,
    releaseDocId,
    releaseDocPath,
    releaseRoute,
    tarballUrl,
    changelog,
    changelogSection,
    aggregateEvidenceLine,
    aggregateEvidenceText: aggregateEvidenceLine ? normalizeEvidenceText(aggregateEvidenceLine) : null,
    aggregateEvidenceCount,
  };
}

function validateCurrentReleaseDoc(ctx, repoRoot) {
  const errors = [];
  const fullPath = join(repoRoot, ctx.releaseDocPath);
  if (!existsSync(fullPath)) {
    errors.push(`release notes page missing: ${ctx.releaseDocPath}`);
    return errors;
  }

  const releaseDoc = read(repoRoot, ctx.releaseDocPath);
  const heading = `# AgentXchain v${ctx.targetVersion}`;
  if (!releaseDoc.includes(heading)) {
    errors.push(`${ctx.releaseDocPath} must contain ${heading}`);
  }

  if (!releaseDoc.match(/## Evidence/i)) {
    errors.push(`${ctx.releaseDocPath} must contain an Evidence section`);
  }

  if (ctx.aggregateEvidenceText && !normalizeEvidenceText(releaseDoc).includes(ctx.aggregateEvidenceText)) {
    errors.push(`${ctx.releaseDocPath} must carry aggregate evidence line "${ctx.aggregateEvidenceLine}"`);
  }

  return errors;
}

function validateTextIncludesVersionAndEvidence(relativePath, label) {
  return {
    id: label,
    check(ctx, repoRoot) {
      const content = read(repoRoot, relativePath);
      const errors = [];
      if (!content.includes(`v${ctx.targetVersion}`)) {
        errors.push(`${relativePath} must mention v${ctx.targetVersion}`);
      }
      if (ctx.aggregateEvidenceText && !normalizeEvidenceText(content).includes(ctx.aggregateEvidenceText)) {
        errors.push(`${relativePath} must carry aggregate evidence line "${ctx.aggregateEvidenceLine}"`);
      }
      return errors;
    },
  };
}

export const RELEASE_ALIGNMENT_SURFACES = [
  {
    id: 'changelog',
    label: 'cli/CHANGELOG.md top target section',
    scopes: [RELEASE_ALIGNMENT_SCOPES.PREBUMP, RELEASE_ALIGNMENT_SCOPES.CURRENT],
    check(ctx) {
      const errors = [];
      if (!ctx.changelogSection) {
        errors.push(`cli/CHANGELOG.md is missing top heading ## ${ctx.targetVersion}`);
      }
      if (!ctx.aggregateEvidenceLine) {
        errors.push(`cli/CHANGELOG.md section ## ${ctx.targetVersion} must contain an aggregate evidence line with 0 failures`);
      }
      return errors;
    },
  },
  {
    id: 'release_notes',
    label: 'current release notes page',
    scopes: [RELEASE_ALIGNMENT_SCOPES.PREBUMP, RELEASE_ALIGNMENT_SCOPES.CURRENT],
    check: validateCurrentReleaseDoc,
  },
  {
    id: 'release_sidebar',
    label: 'website-v2/sidebars.ts release autogen',
    scopes: [RELEASE_ALIGNMENT_SCOPES.PREBUMP, RELEASE_ALIGNMENT_SCOPES.CURRENT],
    check(_ctx, repoRoot) {
      const sidebars = read(repoRoot, 'website-v2/sidebars.ts');
      return /label:\s*'Release Notes'[\s\S]*dirName:\s*'releases'/.test(sidebars)
        ? []
        : [`website-v2/sidebars.ts must keep Release Notes auto-generated from dirName: 'releases'`];
    },
  },
  {
    id: 'homepage_badge',
    label: 'homepage hero badge version',
    scopes: [RELEASE_ALIGNMENT_SCOPES.PREBUMP, RELEASE_ALIGNMENT_SCOPES.CURRENT],
    check(ctx, repoRoot) {
      const home = read(repoRoot, 'website-v2/src/pages/index.tsx');
      return home.includes(`v${ctx.targetVersion}`)
        ? []
        : [`website-v2/src/pages/index.tsx must mention v${ctx.targetVersion}`];
    },
  },
  {
    id: 'homepage_proof_stat',
    label: 'homepage proof stat',
    scopes: [RELEASE_ALIGNMENT_SCOPES.PREBUMP, RELEASE_ALIGNMENT_SCOPES.CURRENT],
    check(ctx, repoRoot) {
      if (ctx.aggregateEvidenceCount == null) {
        return ['homepage proof stat cannot be validated because CHANGELOG aggregate evidence is missing'];
      }
      const home = read(repoRoot, 'website-v2/src/pages/index.tsx');
      const formatted = formatCount(ctx.aggregateEvidenceCount);
      const errors = [];
      if (!home.includes(`stat-number">${formatted}<`)) {
        errors.push(`website-v2/src/pages/index.tsx must show homepage proof stat ${formatted}`);
      }
      if (!home.includes('Tests / 0 failures')) {
        errors.push('website-v2/src/pages/index.tsx must keep the "Tests / 0 failures" proof label');
      }
      return errors;
    },
  },
  {
    id: 'capabilities_version',
    label: '.agentxchain-conformance/capabilities.json version',
    scopes: [RELEASE_ALIGNMENT_SCOPES.PREBUMP, RELEASE_ALIGNMENT_SCOPES.CURRENT],
    check(ctx, repoRoot) {
      const capabilities = readJson(repoRoot, '.agentxchain-conformance/capabilities.json');
      return capabilities.version === ctx.targetVersion
        ? []
        : [`.agentxchain-conformance/capabilities.json version is "${capabilities.version}", expected "${ctx.targetVersion}"`];
    },
  },
  {
    id: 'implementor_guide_version',
    label: 'protocol implementor guide example version',
    scopes: [RELEASE_ALIGNMENT_SCOPES.PREBUMP, RELEASE_ALIGNMENT_SCOPES.CURRENT],
    check(ctx, repoRoot) {
      const guide = read(repoRoot, 'website-v2/docs/protocol-implementor-guide.mdx');
      return guide.includes(`"version": "${ctx.targetVersion}"`)
        ? []
        : [`website-v2/docs/protocol-implementor-guide.mdx must contain "version": "${ctx.targetVersion}"`];
    },
  },
  {
    id: 'launch_evidence_report',
    label: 'launch evidence report',
    scopes: [RELEASE_ALIGNMENT_SCOPES.PREBUMP, RELEASE_ALIGNMENT_SCOPES.CURRENT],
    check(ctx, repoRoot) {
      const report = read(repoRoot, '.planning/LAUNCH_EVIDENCE_REPORT.md');
      const errors = [];
      if (!report.match(new RegExp(`^# Launch Evidence Report — AgentXchain v${escapeRegExp(ctx.targetVersion)}`, 'm'))) {
        errors.push(`.planning/LAUNCH_EVIDENCE_REPORT.md title must carry v${ctx.targetVersion}`);
      }
      if (ctx.aggregateEvidenceText && !normalizeEvidenceText(report).includes(ctx.aggregateEvidenceText)) {
        errors.push(`.planning/LAUNCH_EVIDENCE_REPORT.md must carry aggregate evidence line "${ctx.aggregateEvidenceLine}"`);
      }
      return errors;
    },
  },
  {
    id: 'show_hn_draft',
    label: 'show hn draft',
    scopes: [RELEASE_ALIGNMENT_SCOPES.PREBUMP, RELEASE_ALIGNMENT_SCOPES.CURRENT],
    check: validateTextIncludesVersionAndEvidence('.planning/SHOW_HN_DRAFT.md', 'show hn draft').check,
  },
  {
    id: 'twitter_thread',
    label: 'twitter thread draft',
    scopes: [RELEASE_ALIGNMENT_SCOPES.PREBUMP, RELEASE_ALIGNMENT_SCOPES.CURRENT],
    check: validateTextIncludesVersionAndEvidence('.planning/MARKETING/TWITTER_THREAD.md', 'twitter thread draft').check,
  },
  {
    id: 'reddit_posts',
    label: 'reddit posts draft',
    scopes: [RELEASE_ALIGNMENT_SCOPES.PREBUMP, RELEASE_ALIGNMENT_SCOPES.CURRENT],
    check: validateTextIncludesVersionAndEvidence('.planning/MARKETING/REDDIT_POSTS.md', 'reddit posts draft').check,
  },
  {
    id: 'hn_submission',
    label: 'hn submission draft',
    scopes: [RELEASE_ALIGNMENT_SCOPES.PREBUMP, RELEASE_ALIGNMENT_SCOPES.CURRENT],
    check: validateTextIncludesVersionAndEvidence('.planning/MARKETING/HN_SUBMISSION.md', 'hn submission draft').check,
  },
  {
    id: 'llms_release_route',
    label: 'llms current release route',
    scopes: [RELEASE_ALIGNMENT_SCOPES.PREBUMP, RELEASE_ALIGNMENT_SCOPES.CURRENT],
    check(ctx, repoRoot) {
      const llms = read(repoRoot, 'website-v2/static/llms.txt');
      return llms.includes(ctx.releaseRoute)
        ? []
        : [`website-v2/static/llms.txt must list ${ctx.releaseRoute}`];
    },
  },
  {
    id: 'homebrew_formula_url',
    label: 'homebrew mirror formula url',
    scopes: [RELEASE_ALIGNMENT_SCOPES.CURRENT],
    check(ctx, repoRoot) {
      const formula = read(repoRoot, 'cli/homebrew/agentxchain.rb');
      return formula.includes(`url "${ctx.tarballUrl}"`)
        ? []
        : [`cli/homebrew/agentxchain.rb must point at ${ctx.tarballUrl}`];
    },
  },
  {
    id: 'homebrew_readme',
    label: 'homebrew mirror readme',
    scopes: [RELEASE_ALIGNMENT_SCOPES.CURRENT],
    check(ctx, repoRoot) {
      const readme = read(repoRoot, 'cli/homebrew/README.md');
      const errors = [];
      if (!readme.includes(`- version: \`${ctx.targetVersion}\``)) {
        errors.push(`cli/homebrew/README.md must carry version ${ctx.targetVersion}`);
      }
      if (!readme.includes(`- source tarball: \`${ctx.tarballUrl}\``)) {
        errors.push(`cli/homebrew/README.md must carry tarball ${ctx.tarballUrl}`);
      }
      return errors;
    },
  },
];

export function validateReleaseAlignment(repoRoot, { targetVersion, scope = RELEASE_ALIGNMENT_SCOPES.CURRENT } = {}) {
  if (!Object.values(RELEASE_ALIGNMENT_SCOPES).includes(scope)) {
    throw new Error(`Unsupported release alignment scope "${scope}"`);
  }

  const context = getReleaseAlignmentContext(repoRoot, { targetVersion });
  const surfaces = RELEASE_ALIGNMENT_SURFACES.filter((surface) => surface.scopes.includes(scope));
  const errors = [];
  const surfaceResults = [];

  for (const surface of surfaces) {
    let surfaceErrors = [];
    try {
      surfaceErrors = surface.check(context, repoRoot) || [];
    } catch (error) {
      surfaceErrors = [
        error instanceof Error ? error.message : String(error),
      ];
    }
    surfaceResults.push({
      surface_id: surface.id,
      label: surface.label,
      ok: surfaceErrors.length === 0,
      errors: surfaceErrors,
    });
    for (const error of surfaceErrors) {
      errors.push({
        surface_id: surface.id,
        label: surface.label,
        message: error,
      });
    }
  }

  return {
    ok: errors.length === 0,
    scope,
    targetVersion: context.targetVersion,
    packageVersion: context.packageVersion,
    aggregateEvidenceLine: context.aggregateEvidenceLine,
    checkedSurfaceCount: surfaces.length,
    checkedSurfaceIds: surfaces.map((surface) => surface.id),
    checkedSurfaces: surfaces.map((surface) => ({
      id: surface.id,
      label: surface.label,
      scopes: [...surface.scopes],
    })),
    surfaceResults,
    errors,
  };
}
