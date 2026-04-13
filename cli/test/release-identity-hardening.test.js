import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const CLI_DIR = join(REPO_ROOT, 'cli');
const PLAYBOOK = join(REPO_ROOT, '.planning', 'RELEASE_PLAYBOOK.md');
const SPEC = join(REPO_ROOT, '.planning', 'RELEASE_IDENTITY_HARDENING_SPEC.md');
const BUMP_SCRIPT = join(CLI_DIR, 'scripts', 'release-bump.sh');
const PKG_JSON = join(CLI_DIR, 'package.json');
const FIXTURES = [];

after(() => {
  for (const fixture of FIXTURES) {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

function createReleaseBumpFixture({ version = '2.19.0', existingTagVersion = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'axc-release-bump-'));
  const cliDir = join(root, 'cli');
  const scriptsDir = join(cliDir, 'scripts');
  const websiteDocsReleaseDir = join(root, 'website-v2', 'docs', 'releases');
  const websiteDocsDir = join(root, 'website-v2', 'docs');
  const websitePagesDir = join(root, 'website-v2', 'src', 'pages');
  const planningDir = join(root, '.planning');
  const conformanceDir = join(root, '.agentxchain-conformance');
  const homebrewDir = join(cliDir, 'homebrew');
  const websiteStaticDir = join(root, 'website-v2', 'static');

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(websiteDocsReleaseDir, { recursive: true });
  mkdirSync(websitePagesDir, { recursive: true });
  mkdirSync(websiteStaticDir, { recursive: true });
  mkdirSync(planningDir, { recursive: true });
  mkdirSync(conformanceDir, { recursive: true });
  mkdirSync(homebrewDir, { recursive: true });
  cpSync(BUMP_SCRIPT, join(scriptsDir, 'release-bump.sh'));
  chmodSync(join(scriptsDir, 'release-bump.sh'), 0o755);

  writeFileSync(
    join(cliDir, 'package.json'),
    JSON.stringify({
      name: 'agentxchain',
      version,
      type: 'module',
    }, null, 2) + '\n',
  );
  writeFileSync(
    join(cliDir, 'package-lock.json'),
    JSON.stringify({
      name: 'agentxchain',
      version,
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': {
          name: 'agentxchain',
          version,
        },
      },
    }, null, 2) + '\n',
  );
  writeFileSync(join(cliDir, 'CHANGELOG.md'), `# Changelog\n\n## ${version}\n\nExisting release notes.\n\n### Evidence\n\n- 10 node tests / 2 suites, 0 failures.\n`);
  writeFileSync(join(websiteDocsReleaseDir, `v${version.replace(/\./g, '-')}.mdx`), `---\ntitle: "v${version} Release Notes"\n---\n\n# AgentXchain v${version}\n\n## Evidence\n\n- 10 node tests / 2 suites, 0 failures.\n`);
  writeFileSync(join(root, 'website-v2', 'sidebars.ts'), `'releases/v${version.replace(/\./g, '-')}'\n`);
  writeFileSync(join(websitePagesDir, 'index.tsx'), `<div className="hero-badge">v${version}</div>\n`);
  writeFileSync(join(conformanceDir, 'capabilities.json'), JSON.stringify({ version }, null, 2) + '\n');
  writeFileSync(join(websiteDocsDir, 'protocol-implementor-guide.mdx'), `{"version": "${version}"}\n`);
  writeFileSync(join(planningDir, 'LAUNCH_EVIDENCE_REPORT.md'), `# Launch Evidence Report — AgentXchain v${version}\n`);
  writeFileSync(join(websiteStaticDir, 'llms.txt'), `- [v${version}](https://agentxchain.dev/docs/releases/v${version.replace(/\./g, '-')})\n`);
  writeFileSync(join(websiteStaticDir, 'sitemap.xml'), `<urlset>\n  <url>\n    <loc>https://agentxchain.dev/docs/releases/v${version.replace(/\./g, '-')}</loc>\n  </url>\n</urlset>\n`);
  writeFileSync(join(homebrewDir, 'agentxchain.rb'), `class Agentxchain < Formula
  desc "CLI for AgentXchain governed multi-agent software delivery"
  homepage "https://agentxchain.dev"
  url "https://registry.npmjs.org/agentxchain/-/agentxchain-${version}.tgz"
  sha256 "1111111111111111111111111111111111111111111111111111111111111111"
  license "MIT"
end
`);
  writeFileSync(join(homebrewDir, 'README.md'), `# Homebrew distribution for AgentXchain

- version: \`${version}\`
- source tarball: \`https://registry.npmjs.org/agentxchain/-/agentxchain-${version}.tgz\`
`);

  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root, stdio: 'ignore' });

  if (existingTagVersion) {
    execFileSync('git', ['tag', '-a', `v${existingTagVersion}`, '-m', `v${existingTagVersion}`], { cwd: root, stdio: 'ignore' });
  }

  const fixture = { root, cliDir };
  FIXTURES.push(fixture);
  return fixture;
}

function runReleaseBump(cliDir, targetVersion, { skipPreflight = true } = {}) {
  const args = ['scripts/release-bump.sh', '--target-version', targetVersion];
  if (skipPreflight) args.push('--skip-preflight');
  return spawnSync('bash', args, {
    cwd: cliDir,
    encoding: 'utf8',
    env: process.env,
  });
}

function prepareTargetSurfaces(root, targetVersion) {
  const vDash = targetVersion.replace(/\./g, '-');
  const tarballUrl = `https://registry.npmjs.org/agentxchain/-/agentxchain-${targetVersion}.tgz`;
  writeFileSync(join(root, 'cli', 'CHANGELOG.md'), `# Changelog\n\n## ${targetVersion}\n\nPrepared release notes.\n\n### Evidence\n\n- 11 node tests / 3 suites, 0 failures.\n`);
  mkdirSync(join(root, 'website-v2', 'docs', 'releases'), { recursive: true });
  writeFileSync(join(root, 'website-v2', 'docs', 'releases', `v${vDash}.mdx`), `---\ntitle: "v${targetVersion} Release Notes"\n---\n\n# AgentXchain v${targetVersion}\n\n## Evidence\n\n- 11 node tests / 3 suites, 0 failures.\n`);
  writeFileSync(join(root, 'website-v2', 'sidebars.ts'), `'releases/v${vDash}'\n`);
  writeFileSync(join(root, 'website-v2', 'src', 'pages', 'index.tsx'), `<div className="hero-badge">v${targetVersion}</div>\n`);
  writeFileSync(join(root, '.agentxchain-conformance', 'capabilities.json'), JSON.stringify({ version: targetVersion }, null, 2) + '\n');
  writeFileSync(join(root, 'website-v2', 'docs', 'protocol-implementor-guide.mdx'), `{"version": "${targetVersion}"}\n`);
  writeFileSync(join(root, '.planning', 'LAUNCH_EVIDENCE_REPORT.md'), `# Launch Evidence Report — AgentXchain v${targetVersion}\n`);
  writeFileSync(join(root, 'website-v2', 'static', 'llms.txt'), `- [v${targetVersion}](https://agentxchain.dev/docs/releases/v${vDash})\n`);
  writeFileSync(join(root, 'website-v2', 'static', 'sitemap.xml'), `<urlset>\n  <url>\n    <loc>https://agentxchain.dev/docs/releases/v${vDash}</loc>\n  </url>\n</urlset>\n`);
  writeFileSync(join(root, 'cli', 'homebrew', 'agentxchain.rb'), `class Agentxchain < Formula
  desc "CLI for AgentXchain governed multi-agent software delivery"
  homepage "https://agentxchain.dev"
  url "${tarballUrl}"
  sha256 "2222222222222222222222222222222222222222222222222222222222222222"
  license "MIT"
end
`);
  writeFileSync(join(root, 'cli', 'homebrew', 'README.md'), `# Homebrew distribution for AgentXchain

- version: \`${targetVersion}\`
- source tarball: \`${tarballUrl}\`
`);
}

describe('Release identity hardening', () => {
  describe('AT-RIH-001: release-bump.sh exists and is executable', () => {
    it('script exists', () => {
      assert.ok(existsSync(BUMP_SCRIPT), 'release-bump.sh must exist');
    });

    it('script is executable', () => {
      const stat = statSync(BUMP_SCRIPT);
      const execBit = stat.mode & 0o111;
      assert.ok(execBit > 0, 'release-bump.sh must be executable');
    });

    it('package.json has bump:release script', () => {
      const pkg = JSON.parse(readFileSync(PKG_JSON, 'utf8'));
      assert.ok(
        pkg.scripts['bump:release'],
        'package.json must have a bump:release script',
      );
      assert.ok(
        pkg.scripts['bump:release'].includes('release-bump.sh'),
        'bump:release must reference release-bump.sh',
      );
    });
  });

  describe('AT-RIH-002: Playbook references bump:release instead of raw npm version', () => {
    const playbook = readFileSync(PLAYBOOK, 'utf8');

    it('playbook contains bump:release command', () => {
      assert.ok(
        playbook.includes('npm run bump:release'),
        'playbook must reference bump:release',
      );
    });

    it('playbook does not use raw npm version for release identity', () => {
      // The "Create Release Identity" section should use bump:release, not npm version
      const identitySection = playbook.split('### 2. Create Release Identity')[1]?.split('### 3.')[0] || '';
      assert.ok(
        identitySection.includes('bump:release'),
        'Release Identity section must use bump:release',
      );
      assert.ok(
        identitySection.includes('Do not use raw `npm version'),
        'Release Identity section must warn against raw npm version',
      );
    });

    it('playbook explains why bump:release exists', () => {
      assert.ok(
        playbook.includes('may update files without creating git identity'),
        'playbook must explain the subdirectory git identity defect',
      );
    });
  });

  describe('AT-RIH-003: Playbook lists postflight:downstream as required', () => {
    const playbook = readFileSync(PLAYBOOK, 'utf8');

    it('downstream truth section is marked REQUIRED', () => {
      assert.ok(
        playbook.includes('### Downstream Truth Verification (REQUIRED)'),
        'downstream truth section must be marked REQUIRED',
      );
    });

    it('playbook states release is not complete without downstream truth', () => {
      assert.ok(
        playbook.includes('release is **not complete** until downstream truth verification passes') ||
        playbook.includes('not complete with a stale tap') ||
        playbook.includes('incomplete release'),
        'playbook must state that a stale tap means incomplete release',
      );
    });
  });

  describe('AT-RIH-004: Playbook documents manual Homebrew tap follow-through', () => {
    const playbook = readFileSync(PLAYBOOK, 'utf8');

    it('playbook mentions manual tap push when CI cannot push', () => {
      assert.ok(
        playbook.includes('operator must') &&
        playbook.includes('sync:homebrew') &&
        playbook.includes('push-tap'),
        'playbook must document the manual tap push requirement when CI cannot push',
      );
    });

    it('error cases include stale canonical tap', () => {
      assert.ok(
        playbook.includes('Canonical Homebrew tap is stale'),
        'error cases must include stale canonical tap',
      );
    });
  });

  describe('release-bump.sh contract', () => {
    const script = readFileSync(BUMP_SCRIPT, 'utf8');

    it('uses --no-git-tag-version to separate file update from git ops', () => {
      assert.ok(
        script.includes('--no-git-tag-version'),
        'script must use --no-git-tag-version',
      );
    });

    it('creates an annotated tag (not lightweight)', () => {
      assert.ok(
        script.includes('git tag -a'),
        'script must create annotated tag with -a flag',
      );
    });

    it('verifies tag existence before exiting', () => {
      assert.ok(
        script.includes('git rev-parse "v${TARGET_VERSION}"') ||
        script.includes('git rev-parse "v$TARGET_VERSION"'),
        'script must verify tag exists with git rev-parse',
      );
    });

    it('checks for clean tree before bumping', () => {
      assert.ok(
        script.includes('allowed release surfaces'),
        'script must check that only allowed release-surface dirt is present',
      );
    });

    it('prevents double-bump', () => {
      assert.ok(
        script.includes('already at') || script.includes('double-bump'),
        'script must prevent bumping to the same version',
      );
    });

    it('checks for pre-existing tag', () => {
      assert.ok(
        script.includes('already exists'),
        'script must check for pre-existing tag',
      );
    });

    it('runs pre-bump version-surface alignment guard', () => {
      assert.ok(
        script.includes('version-surface alignment') || script.includes('version-surface(s) not aligned'),
        'script must check version-surface alignment before creating release identity',
      );
      assert.ok(
        script.includes('SURFACE_ERRORS'),
        'script must collect surface errors and fail closed if any are stale',
      );
    });

    it('auto-aligns Homebrew mirror formula and README to target version', () => {
      assert.ok(
        script.includes('Auto-aligning Homebrew mirror') || script.includes('Auto-align Homebrew mirror'),
        'script must auto-align Homebrew mirror formula and README to the target version',
      );
      assert.ok(
        script.includes('agentxchain.rb'),
        'auto-alignment must reference the Homebrew formula',
      );
      assert.ok(
        script.includes('homebrew/README.md') || script.includes('HOMEBREW_MIRROR_README'),
        'auto-alignment must reference the Homebrew README',
      );
      assert.ok(
        script.includes('SHA carried from previous version') || script.includes('post-publish'),
        'script must document that SHA is a post-publish artifact',
      );
      assert.ok(
        script.includes('normalized back to committed pre-publish SHA') ||
        script.includes('carried from committed pre-publish SHA'),
        'script must explicitly carry the committed formula SHA instead of trusting working-tree edits',
      );
    });

    it('verifies the tag is annotated and resolves to the release commit', () => {
      assert.ok(
        script.includes('git cat-file -t "v${TARGET_VERSION}"'),
        'script must verify the tag object type',
      );
      assert.ok(
        script.includes('git rev-parse "v${TARGET_VERSION}^{}"'),
        'script must verify the tag dereferences to the release commit',
      );
    });
  });

  describe('spec exists and aligns with implementation', () => {
    it('spec file exists', () => {
      assert.ok(existsSync(SPEC), 'RELEASE_IDENTITY_HARDENING_SPEC.md must exist');
    });

    it('spec references both defects', () => {
      const spec = readFileSync(SPEC, 'utf8');
      assert.ok(
        spec.includes('npm version') && spec.includes('annotated tag'),
        'spec must describe the npm version identity defect',
      );
      assert.ok(
        spec.includes('HOMEBREW_TAP_TOKEN') && spec.includes('canonical tap'),
        'spec must describe the Homebrew tap automation gap',
      );
      assert.ok(
        spec.includes('working-tree SHA') || spec.includes('previous committed formula'),
        'spec must describe the Homebrew pre-publish SHA carry invariant',
      );
    });

    it('spec includes execution-level acceptance tests', () => {
      const spec = readFileSync(SPEC, 'utf8');
      assert.match(spec, /AT-RIH-005/, 'spec must require subprocess proof for release identity');
      assert.match(spec, /AT-RIH-006/, 'spec must require fail-closed mutation guards');
      assert.match(spec, /AT-RIH-007/, 'spec must require release-surface inclusion proof');
      assert.match(spec, /AT-RIH-009/, 'spec must require Homebrew mirror release-surface proof');
      assert.match(spec, /AT-RIH-010/, 'spec must require discovery-surface release proof');
    });
  });

  describe('AT-RIH-005: release-bump.sh creates real release identity in a temp repo', () => {
    it('updates version files, creates the release commit, and creates an annotated tag', () => {
      const fixture = createReleaseBumpFixture();
      // Prepare version surfaces for the target version (pre-bump guard requires this)
      prepareTargetSurfaces(fixture.root, '2.20.0');
      const result = runReleaseBump(fixture.cliDir, '2.20.0');

      assert.equal(result.status, 0, result.stderr || result.stdout);

      const pkg = JSON.parse(readFileSync(join(fixture.cliDir, 'package.json'), 'utf8'));
      const lock = JSON.parse(readFileSync(join(fixture.cliDir, 'package-lock.json'), 'utf8'));
      assert.equal(pkg.version, '2.20.0');
      assert.equal(lock.version, '2.20.0');
      assert.equal(lock.packages[''].version, '2.20.0');

      const commitMessage = execFileSync('git', ['log', '-1', '--format=%s'], {
        cwd: fixture.root,
        encoding: 'utf8',
      }).trim();
      assert.equal(commitMessage, '2.20.0');

      const tagType = execFileSync('git', ['cat-file', '-t', 'v2.20.0'], {
        cwd: fixture.root,
        encoding: 'utf8',
      }).trim();
      assert.equal(tagType, 'tag');

      const tagTarget = execFileSync('git', ['rev-parse', 'v2.20.0^{}'], {
        cwd: fixture.root,
        encoding: 'utf8',
      }).trim();
      const headSha = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: fixture.root,
        encoding: 'utf8',
      }).trim();
      assert.equal(tagTarget, headSha, 'annotated tag must dereference to HEAD');
      assert.match(result.stdout, /Release identity created successfully/);
      assert.match(result.stdout, /Phase 1.*stale SHA/i, 'success banner must remind operator of Phase 1 stale-SHA state');
      assert.match(result.stdout, /sync-homebrew/, 'success banner must mention sync-homebrew.sh for Phase 3');
    });
  });

  describe('AT-RIH-006: release-bump.sh fails closed before mutating version files', () => {
    it('rejects a dirty tree before updating package.json or creating a tag', () => {
      const fixture = createReleaseBumpFixture();
      writeFileSync(join(fixture.cliDir, 'DIRTY.txt'), 'untracked change\n');

      const result = runReleaseBump(fixture.cliDir, '2.20.0');
      assert.equal(result.status, 1);
      assert.match(result.stderr, /changes outside the allowed release surfaces/);

      const pkg = JSON.parse(readFileSync(join(fixture.cliDir, 'package.json'), 'utf8'));
      assert.equal(pkg.version, '2.19.0');

      const tagLookup = spawnSync('git', ['rev-parse', 'v2.20.0'], {
        cwd: fixture.root,
        encoding: 'utf8',
      });
      assert.notEqual(tagLookup.status, 0, 'target tag must not be created on dirty-tree failure');
    });

    it('rejects a pre-existing target tag before updating version files', () => {
      const fixture = createReleaseBumpFixture({ existingTagVersion: '2.20.0' });

      const result = runReleaseBump(fixture.cliDir, '2.20.0');
      assert.equal(result.status, 1);
      assert.match(result.stderr, /tag v2.20.0 already exists/);

      const pkg = JSON.parse(readFileSync(join(fixture.cliDir, 'package.json'), 'utf8'));
      assert.equal(pkg.version, '2.19.0');
    });
  });

  describe('AT-RIH-008: release-bump.sh rejects stale version surfaces before creating release identity', () => {
    it('fails when version surfaces still reference the old version', () => {
      const fixture = createReleaseBumpFixture();
      // Do NOT call prepareTargetSurfaces — surfaces still show 2.19.0
      const result = runReleaseBump(fixture.cliDir, '2.20.0');
      assert.equal(result.status, 1);
      assert.match(result.stderr, /version-surface.*not aligned/);

      // Verify no mutation happened
      const pkg = JSON.parse(readFileSync(join(fixture.cliDir, 'package.json'), 'utf8'));
      assert.equal(pkg.version, '2.19.0', 'package.json must not be mutated when surfaces are stale');

      const tagLookup = spawnSync('git', ['rev-parse', 'v2.20.0'], {
        cwd: fixture.root,
        encoding: 'utf8',
      });
      assert.notEqual(tagLookup.status, 0, 'target tag must not be created when surfaces are stale');
    });

    it('fails when a single surface is stale (partial drift)', () => {
      const fixture = createReleaseBumpFixture();
      prepareTargetSurfaces(fixture.root, '2.20.0');
      // Revert just the capabilities.json to old version
      writeFileSync(join(fixture.root, '.agentxchain-conformance', 'capabilities.json'), JSON.stringify({ version: '2.19.0' }, null, 2) + '\n');

      const result = runReleaseBump(fixture.cliDir, '2.20.0');
      assert.equal(result.status, 1);
      assert.match(result.stderr, /capabilities\.json/);
      assert.match(result.stderr, /version-surface.*not aligned/);
    });

    it('AT-RIH-010: fails when llms.txt omits the current release route', () => {
      const fixture = createReleaseBumpFixture();
      prepareTargetSurfaces(fixture.root, '2.20.0');
      writeFileSync(join(fixture.root, 'website-v2', 'static', 'llms.txt'), '- [v2.19.0](https://agentxchain.dev/docs/releases/v2-19-0)\n');

      const result = runReleaseBump(fixture.cliDir, '2.20.0');
      assert.equal(result.status, 1);
      assert.match(result.stderr, /website-v2\/static\/llms\.txt/);
      assert.match(result.stderr, /version-surface.*not aligned/);
    });

    it('fails when sitemap.xml omits the current release route', () => {
      const fixture = createReleaseBumpFixture();
      prepareTargetSurfaces(fixture.root, '2.20.0');
      writeFileSync(join(fixture.root, 'website-v2', 'static', 'sitemap.xml'), '<urlset>\n</urlset>\n');

      const result = runReleaseBump(fixture.cliDir, '2.20.0');
      assert.equal(result.status, 1);
      assert.match(result.stderr, /website-v2\/static\/sitemap\.xml/);
      assert.match(result.stderr, /version-surface.*not aligned/);
    });

    it('auto-aligns stale Homebrew mirror instead of rejecting the bump', () => {
      const fixture = createReleaseBumpFixture();
      prepareTargetSurfaces(fixture.root, '2.20.0');
      // Leave Homebrew at old version — the script should auto-align it
      writeFileSync(join(fixture.root, 'cli', 'homebrew', 'agentxchain.rb'), 'class Agentxchain < Formula\n  desc "CLI for AgentXchain governed multi-agent software delivery"\n  homepage "https://agentxchain.dev"\n  url "https://registry.npmjs.org/agentxchain/-/agentxchain-2.19.0.tgz"\n  sha256 "1111111111111111111111111111111111111111111111111111111111111111"\n  license "MIT"\nend\n');
      writeFileSync(join(fixture.root, 'cli', 'homebrew', 'README.md'), '# Homebrew distribution for AgentXchain\n\n- version: `2.19.0`\n- source tarball: `https://registry.npmjs.org/agentxchain/-/agentxchain-2.19.0.tgz`\n');

      const result = runReleaseBump(fixture.cliDir, '2.20.0');
      assert.equal(result.status, 0, result.stderr || result.stdout);

      // Verify the formula was auto-aligned to the target version URL
      const formula = readFileSync(join(fixture.root, 'cli', 'homebrew', 'agentxchain.rb'), 'utf8');
      assert.match(formula, /agentxchain-2\.20\.0\.tgz/);
      // SHA should be carried from the committed old version (not recomputed)
      assert.match(formula, /1111111111111111111111111111111111111111111111111111111111111111/);

      // Verify the README was auto-aligned
      const readme = readFileSync(join(fixture.root, 'cli', 'homebrew', 'README.md'), 'utf8');
      assert.match(readme, /- version: `2\.20\.0`/);
      assert.match(readme, /agentxchain-2\.20\.0\.tgz/);

      // Verify both files are included in the release commit
      const changedFiles = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], {
        cwd: fixture.root,
        encoding: 'utf8',
      }).trim().split('\n').filter(Boolean);
      assert.ok(changedFiles.includes('cli/homebrew/agentxchain.rb'));
      assert.ok(changedFiles.includes('cli/homebrew/README.md'));
    });

    it('AT-HPSG-001: overwrites a hand-edited target-version SHA with the previous committed SHA', () => {
      const fixture = createReleaseBumpFixture();
      prepareTargetSurfaces(fixture.root, '2.20.0');

      const formulaPath = join(fixture.root, 'cli', 'homebrew', 'agentxchain.rb');
      writeFileSync(formulaPath, `class Agentxchain < Formula
  desc "CLI for AgentXchain governed multi-agent software delivery"
  homepage "https://agentxchain.dev"
  url "https://registry.npmjs.org/agentxchain/-/agentxchain-2.20.0.tgz"
  sha256 "3333333333333333333333333333333333333333333333333333333333333333"
  license "MIT"
end
`);

      const result = runReleaseBump(fixture.cliDir, '2.20.0');
      assert.equal(result.status, 0, result.stderr || result.stdout);

      const formula = readFileSync(formulaPath, 'utf8');
      assert.match(formula, /agentxchain-2\.20\.0\.tgz/);
      assert.match(formula, /1111111111111111111111111111111111111111111111111111111111111111/);
      assert.doesNotMatch(formula, /3333333333333333333333333333333333333333333333333333333333333333/);
      assert.match(result.stdout, /normalized back to committed pre-publish SHA/);
    });

    it('AT-HPSG-003: fails closed when the previous committed formula SHA is not parseable', () => {
      const fixture = createReleaseBumpFixture();
      prepareTargetSurfaces(fixture.root, '2.20.0');

      writeFileSync(join(fixture.root, 'cli', 'homebrew', 'agentxchain.rb'), `class Agentxchain < Formula
  desc "CLI for AgentXchain governed multi-agent software delivery"
  homepage "https://agentxchain.dev"
  url "https://registry.npmjs.org/agentxchain/-/agentxchain-2.19.0.tgz"
  sha256 "not-a-real-sha"
  license "MIT"
end
`);
      execFileSync('git', ['add', 'cli/homebrew/agentxchain.rb'], { cwd: fixture.root, stdio: 'ignore' });
      execFileSync('git', ['commit', '-m', 'break formula sha'], { cwd: fixture.root, stdio: 'ignore' });

      prepareTargetSurfaces(fixture.root, '2.20.0');

      const result = runReleaseBump(fixture.cliDir, '2.20.0');
      assert.equal(result.status, 1);
      assert.match(result.stderr, /HEAD:cli\/homebrew\/agentxchain\.rb does not contain a parseable sha256/);

      const tagLookup = spawnSync('git', ['rev-parse', 'v2.20.0'], {
        cwd: fixture.root,
        encoding: 'utf8',
      });
      assert.notEqual(tagLookup.status, 0, 'target tag must not be created when committed Homebrew SHA is malformed');
    });
  });

  describe('AT-PBT: preflight-before-tag release identity ordering', () => {
    const script = readFileSync(BUMP_SCRIPT, 'utf8');
    const PREFLIGHT_SPEC = join(REPO_ROOT, '.planning', 'PREFLIGHT_BEFORE_TAG_SPEC.md');

    it('AT-PBT-001: inline preflight gate runs between commit creation and tag creation', () => {
      // The script must contain inline preflight logic after commit and before tag
      const commitIdx = script.indexOf('Creating release commit');
      const preflightIdx = script.indexOf('Inline preflight gate');
      const tagIdx = script.indexOf('Create annotated tag');
      assert.ok(commitIdx > 0, 'script must contain commit creation step');
      assert.ok(preflightIdx > 0, 'script must contain inline preflight gate');
      assert.ok(tagIdx > 0, 'script must contain tag creation step');
      assert.ok(preflightIdx > commitIdx, 'inline preflight must come after commit creation');
      assert.ok(preflightIdx < tagIdx, 'inline preflight must come before tag creation');
    });

    it('AT-PBT-002: inline preflight exits with code 1 on failure without creating tag', () => {
      assert.ok(
        script.includes('PREFLIGHT FAILED') && script.includes('NOT tagged'),
        'script must print clear failure message when preflight fails before tag',
      );
      assert.ok(
        script.includes('PREFLIGHT_FAILED=1'),
        'script must track preflight failure state',
      );
    });

    it('AT-PBT-003: --skip-preflight bypasses inline preflight gate', () => {
      assert.ok(
        script.includes('--skip-preflight'),
        'script must support --skip-preflight flag',
      );
      assert.ok(
        script.includes('SKIP_PREFLIGHT'),
        'script must use SKIP_PREFLIGHT variable',
      );
      // Verify skip-preflight bypasses the gate but still creates tag
      const fixture = createReleaseBumpFixture();
      prepareTargetSurfaces(fixture.root, '2.20.0');
      const result = runReleaseBump(fixture.cliDir, '2.20.0', { skipPreflight: true });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /SKIPPED.*--skip-preflight/);
      // Tag must exist
      const tagType = execFileSync('git', ['cat-file', '-t', 'v2.20.0'], {
        cwd: fixture.root,
        encoding: 'utf8',
      }).trim();
      assert.equal(tagType, 'tag');
    });

    it('AT-PBT-004: inline preflight runs with release environment variables', () => {
      assert.ok(
        script.includes('AGENTXCHAIN_RELEASE_TARGET_VERSION="${TARGET_VERSION}"'),
        'inline preflight must set AGENTXCHAIN_RELEASE_TARGET_VERSION',
      );
      assert.ok(
        script.includes('AGENTXCHAIN_RELEASE_PREFLIGHT=1'),
        'inline preflight must set AGENTXCHAIN_RELEASE_PREFLIGHT=1',
      );
    });

    it('AT-PBT-005: post-success output does not tell operator to run preflight manually', () => {
      // When preflight is not skipped, the success output should not say "Next: npm run preflight:release:strict"
      assert.ok(
        !script.includes('Next: npm run preflight:release:strict'),
        'success output must not instruct operator to run preflight manually (it already ran inline)',
      );
    });

    it('inline preflight runs npm test, npm pack, and docs build', () => {
      assert.ok(
        script.includes('npm test'),
        'inline preflight must run npm test',
      );
      assert.ok(
        script.includes('npm pack --dry-run'),
        'inline preflight must run npm pack --dry-run',
      );
      assert.ok(
        script.includes('npm run build'),
        'inline preflight must run docs build',
      );
    });

    it('preflight-before-tag spec exists', () => {
      assert.ok(existsSync(PREFLIGHT_SPEC), 'PREFLIGHT_BEFORE_TAG_SPEC.md must exist');
    });

    it('preflight-before-tag spec defines the ordering invariant', () => {
      const spec = readFileSync(PREFLIGHT_SPEC, 'utf8');
      assert.ok(
        spec.includes('DEC-RELEASE-PROCESS-005'),
        'spec must reference the preflight-before-tag decision',
      );
      assert.ok(
        spec.includes('tag') && spec.includes('preflight'),
        'spec must describe the tag-after-preflight invariant',
      );
    });
  });

  describe('AT-RIH-007: release-bump.sh includes allowed release-surface edits in the release commit', () => {
    it('commits target-version release surfaces alongside package version files', () => {
      const fixture = createReleaseBumpFixture();
      writeFileSync(join(fixture.cliDir, 'CHANGELOG.md'), '# Changelog\n\n## 2.20.0\n\nPrepared release notes.\n\n### Evidence\n\n- 11 node tests / 3 suites, 0 failures.\n');
      writeFileSync(join(fixture.root, 'website-v2', 'docs', 'releases', 'v2-20-0.mdx'), '---\ntitle: "v2.20.0 Release Notes"\n---\n\n# AgentXchain v2.20.0\n\n## Evidence\n\n- 11 node tests / 3 suites, 0 failures.\n');
      writeFileSync(join(fixture.root, 'website-v2', 'sidebars.ts'), "'releases/v2-20-0'\n");
      writeFileSync(join(fixture.root, 'website-v2', 'src', 'pages', 'index.tsx'), '<div className="hero-badge">v2.20.0</div>\n');
      writeFileSync(join(fixture.root, '.agentxchain-conformance', 'capabilities.json'), JSON.stringify({ version: '2.20.0' }, null, 2) + '\n');
      writeFileSync(join(fixture.root, 'website-v2', 'docs', 'protocol-implementor-guide.mdx'), '{"version": "2.20.0"}\n');
      writeFileSync(join(fixture.root, '.planning', 'LAUNCH_EVIDENCE_REPORT.md'), '# Launch Evidence Report — AgentXchain v2.20.0\n');
      writeFileSync(join(fixture.root, 'website-v2', 'static', 'llms.txt'), '- [v2.20.0](https://agentxchain.dev/docs/releases/v2-20-0)\n');
      writeFileSync(join(fixture.root, 'website-v2', 'static', 'sitemap.xml'), '<urlset>\n  <url>\n    <loc>https://agentxchain.dev/docs/releases/v2-20-0</loc>\n  </url>\n</urlset>\n');
      writeFileSync(join(fixture.root, 'cli', 'homebrew', 'agentxchain.rb'), 'class Agentxchain < Formula\n  desc "CLI for AgentXchain governed multi-agent software delivery"\n  homepage "https://agentxchain.dev"\n  url "https://registry.npmjs.org/agentxchain/-/agentxchain-2.20.0.tgz"\n  sha256 "3333333333333333333333333333333333333333333333333333333333333333"\n  license "MIT"\nend\n');
      writeFileSync(join(fixture.root, 'cli', 'homebrew', 'README.md'), '# Homebrew distribution for AgentXchain\n\n- version: `2.20.0`\n- source tarball: `https://registry.npmjs.org/agentxchain/-/agentxchain-2.20.0.tgz`\n');

      const result = runReleaseBump(fixture.cliDir, '2.20.0');
      assert.equal(result.status, 0, result.stderr || result.stdout);

      const changedFiles = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], {
        cwd: fixture.root,
        encoding: 'utf8',
      }).trim().split('\n').filter(Boolean);

      assert.ok(changedFiles.includes('cli/CHANGELOG.md'));
      assert.ok(changedFiles.includes('website-v2/docs/releases/v2-20-0.mdx'));
      assert.ok(changedFiles.includes('website-v2/sidebars.ts'));
      assert.ok(changedFiles.includes('website-v2/src/pages/index.tsx'));
      assert.ok(changedFiles.includes('.agentxchain-conformance/capabilities.json'));
      assert.ok(changedFiles.includes('website-v2/docs/protocol-implementor-guide.mdx'));
      assert.ok(changedFiles.includes('.planning/LAUNCH_EVIDENCE_REPORT.md'));
      assert.ok(changedFiles.includes('website-v2/static/llms.txt'));
      assert.ok(changedFiles.includes('website-v2/static/sitemap.xml'));
      assert.ok(changedFiles.includes('cli/homebrew/agentxchain.rb'));
      assert.ok(changedFiles.includes('cli/homebrew/README.md'));
    });
  });
});
