import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

/**
 * Bidirectional flag-alignment guard for the plugin command family.
 *
 * Reads cli/bin/agentxchain.js for the registered plugin subcommands and flags,
 * then asserts that cli.mdx and plugins.mdx document them truthfully.
 */

describe('Plugin CLI docs contract', () => {
  const cliSource = read('cli/bin/agentxchain.js');
  const cliDocs = read('website-v2/docs/cli.mdx');
  const pluginsDocs = read('website-v2/docs/plugins.mdx');

  describe('subcommand completeness in cli.mdx', () => {
    const registeredSubcommands = ['install', 'list', 'remove', 'upgrade'];

    for (const sub of registeredSubcommands) {
      it(`cli.mdx documents plugin ${sub}`, () => {
        assert.match(cliDocs, new RegExp(`\`${sub}`));
      });
    }
  });

  describe('flag alignment — install', () => {
    it('agentxchain.js registers --config, --config-file, --json for install', () => {
      // Extract the install block from source
      const installBlock = cliSource.match(/pluginCmd\s*\n\s*\.command\('install <source>'\)[\s\S]*?\.action\(pluginInstallCommand\)/);
      assert.ok(installBlock, 'install command block found in agentxchain.js');
      assert.match(installBlock[0], /--config <json>/);
      assert.match(installBlock[0], /--config-file <path>/);
      assert.match(installBlock[0], /--json/);
    });

    it('cli.mdx documents --config, --config-file, --json for plugin install', () => {
      assert.match(cliDocs, /plugin install.*flags/i);
      assert.match(cliDocs, /`--config <json>`/);
      assert.match(cliDocs, /`--config-file <path>`/);
    });

    it('plugins.mdx documents install flags', () => {
      assert.match(pluginsDocs, /Install flags/i);
      assert.match(pluginsDocs, /--config <json>/);
      assert.match(pluginsDocs, /--config-file <path>/);
      assert.match(pluginsDocs, /--json/);
    });
  });

  describe('flag alignment — list', () => {
    it('agentxchain.js registers --json for list', () => {
      const listBlock = cliSource.match(/pluginCmd\s*\n\s*\.command\('list'\)[\s\S]*?\.action\(pluginListCommand\)/);
      assert.ok(listBlock, 'list command block found in agentxchain.js');
      assert.match(listBlock[0], /--json/);
      // list must NOT have --config or --config-file
      assert.doesNotMatch(listBlock[0], /--config </);
    });

    it('cli.mdx documents --json for plugin list', () => {
      assert.match(cliDocs, /plugin list.*flags/i);
    });
  });

  describe('flag alignment — upgrade', () => {
    it('agentxchain.js registers upgrade as <name> [source], not --from', () => {
      const upgradeBlock = cliSource.match(/pluginCmd\s*\n\s*\.command\('upgrade <name> \[source\]'\)/);
      assert.ok(upgradeBlock, 'upgrade uses positional [source], not a --from flag');
    });

    it('agentxchain.js registers --config, --config-file, --json for upgrade', () => {
      const upgradeBlock = cliSource.match(/pluginCmd\s*\n\s*\.command\('upgrade <name> \[source\]'\)[\s\S]*?\.action\(pluginUpgradeCommand\)/);
      assert.ok(upgradeBlock, 'upgrade command block found');
      assert.match(upgradeBlock[0], /--config <json>/);
      assert.match(upgradeBlock[0], /--config-file <path>/);
      assert.match(upgradeBlock[0], /--json/);
    });

    it('cli.mdx documents upgrade with [source] positional', () => {
      assert.match(cliDocs, /upgrade <name> \[source\]/);
    });

    it('plugins.mdx does NOT contain ghost --from flag', () => {
      assert.doesNotMatch(pluginsDocs, /--from/);
    });

    it('plugins.mdx documents upgrade flags', () => {
      // upgrade section should have flag table with --config, --config-file, --json
      const upgradeSection = pluginsDocs.match(/## Upgrading plugins[\s\S]*?## Removing plugins/);
      assert.ok(upgradeSection, 'upgrade section found');
      assert.match(upgradeSection[0], /--config <json>/);
      assert.match(upgradeSection[0], /--config-file <path>/);
      assert.match(upgradeSection[0], /--json/);
    });

    it('plugins.mdx documents positional source parameter for upgrade', () => {
      assert.match(pluginsDocs, /\[source\].*positional|positional.*\[source\]/i);
    });
  });

  describe('flag alignment — remove', () => {
    it('agentxchain.js registers --json for remove', () => {
      const removeBlock = cliSource.match(/pluginCmd\s*\n\s*\.command\('remove <name>'\)[\s\S]*?\.action\(pluginRemoveCommand\)/);
      assert.ok(removeBlock, 'remove command block found');
      assert.match(removeBlock[0], /--json/);
      assert.doesNotMatch(removeBlock[0], /--config </);
    });

    it('plugins.mdx documents --json for remove', () => {
      const removeSection = pluginsDocs.match(/## Removing plugins[\s\S]*?## Authoring/);
      assert.ok(removeSection, 'remove section found');
      assert.match(removeSection[0], /--json/);
    });
  });

  describe('ghost flag rejection', () => {
    it('plugins.mdx does not document --force anywhere because the CLI does not ship it', () => {
      assert.doesNotMatch(pluginsDocs, /--force/);
    });

    it('cli.mdx does not document --from flag', () => {
      assert.doesNotMatch(cliDocs, /--from/);
    });
  });

  describe('mutual exclusivity contract', () => {
    it('cli.mdx or plugins.mdx documents --config / --config-file mutual exclusivity', () => {
      const mentionsMutex = cliDocs.includes('mutually exclusive') || pluginsDocs.includes('mutually exclusive');
      assert.ok(mentionsMutex, 'mutual exclusivity of --config and --config-file must be documented');
    });
  });
});
