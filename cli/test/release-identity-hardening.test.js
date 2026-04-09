import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';

const REPO_ROOT = join(process.cwd(), '..');
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

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(websiteDocsReleaseDir, { recursive: true });
  mkdirSync(websitePagesDir, { recursive: true });
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

function runReleaseBump(cliDir, targetVersion) {
  return spawnSync('bash', ['scripts/release-bump.sh', '--target-version', targetVersion], {
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

    it('checks Homebrew mirror formula as a governed version surface', () => {
      assert.ok(
        script.includes('homebrew mirror formula') || script.includes('agentxchain.rb'),
        'pre-bump guard must check the Homebrew mirror formula version',
      );
    });

    it('checks Homebrew mirror README as a governed version surface', () => {
      assert.ok(
        script.includes('homebrew mirror README') || script.includes('cli/homebrew/README.md'),
        'pre-bump guard must check the Homebrew mirror README version metadata',
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
    });

    it('spec includes execution-level acceptance tests', () => {
      const spec = readFileSync(SPEC, 'utf8');
      assert.match(spec, /AT-RIH-005/, 'spec must require subprocess proof for release identity');
      assert.match(spec, /AT-RIH-006/, 'spec must require fail-closed mutation guards');
      assert.match(spec, /AT-RIH-007/, 'spec must require release-surface inclusion proof');
      assert.match(spec, /AT-RIH-009/, 'spec must require Homebrew mirror release-surface proof');
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

    it('fails when the mirrored Homebrew README is stale', () => {
      const fixture = createReleaseBumpFixture();
      prepareTargetSurfaces(fixture.root, '2.20.0');
      writeFileSync(join(fixture.root, 'cli', 'homebrew', 'README.md'), '# Homebrew distribution for AgentXchain\n\n- version: `2.19.0`\n- source tarball: `https://registry.npmjs.org/agentxchain/-/agentxchain-2.19.0.tgz`\n');

      const result = runReleaseBump(fixture.cliDir, '2.20.0');
      assert.equal(result.status, 1);
      assert.match(result.stderr, /homebrew mirror README/);
      assert.match(result.stderr, /version-surface.*not aligned/);
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
      assert.ok(changedFiles.includes('cli/homebrew/agentxchain.rb'));
      assert.ok(changedFiles.includes('cli/homebrew/README.md'));
    });
  });
});
