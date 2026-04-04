import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

describe('Plugin docs surface', () => {

  describe('Docusaurus source page exists and covers plugin content', () => {
    it('plugins.mdx exists', () => {
      assert.ok(existsSync(resolve(ROOT, 'website-v2/docs/plugins.mdx')));
    });

    it('plugins.mdx documents the manifest format', () => {
      const page = read('website-v2/docs/plugins.mdx');
      assert.match(page, /agentxchain-plugin\.json/);
      assert.match(page, /"schema_version": "0\.1"/);
      assert.match(page, /version/);
      assert.match(page, /"hooks": \{/);
    });

    it('plugins.mdx documents install, list, upgrade, and remove', () => {
      const page = read('website-v2/docs/plugins.mdx');
      assert.match(page, /plugin install/);
      assert.match(page, /plugin list/);
      assert.match(page, /plugin upgrade/);
      assert.match(page, /plugin remove/);
    });

    it('plugins.mdx documents collision protection', () => {
      const page = read('website-v2/docs/plugins.mdx');
      assert.match(page, /collision/i);
    });

    it('plugins.mdx documents path rewriting or failure modes', () => {
      const page = read('website-v2/docs/plugins.mdx');
      assert.match(page, /rewrite|rewriting|failure/i);
    });

    it('plugins.mdx documents shipped hook phases instead of obsolete event names', () => {
      const page = read('website-v2/docs/plugins.mdx');
      assert.match(page, /after_acceptance/);
      assert.match(page, /before_gate/);
      assert.match(page, /on_escalation/);
      assert.doesNotMatch(page, /turn:accepted/);
      assert.doesNotMatch(page, /gate:transition/);
      assert.doesNotMatch(page, /run:completed/);
    });

    it('plugins.mdx documents process/http hook definitions, not legacy script fields', () => {
      const page = read('website-v2/docs/plugins.mdx');
      assert.match(page, /`process` or `http`/);
      assert.match(page, /`command`/);
      assert.match(page, /JSON on stdin|JSON-stdin|JSON stdin/i);
      assert.doesNotMatch(page, /"hooks": \[/);
      assert.doesNotMatch(page, /"event":/);
      assert.doesNotMatch(page, /"run": "\.\/hooks\//);
      assert.doesNotMatch(page, /`script`/);
    });

    it('plugins.mdx documents actual plugin list JSON shape and install metadata', () => {
      const page = read('website-v2/docs/plugins.mdx');
      assert.match(page, /"plugins": \[/);
      assert.match(page, /"install_path":/);
      assert.match(page, /"installed": true/);
      assert.match(page, /"source": \{/);
    });

    it('plugins.mdx documents AGENTXCHAIN_PLUGIN_CONFIG as JSON env, not file path', () => {
      const page = read('website-v2/docs/plugins.mdx');
      assert.match(page, /AGENTXCHAIN_PLUGIN_CONFIG/);
      assert.match(page, /JSON string/i);
      assert.doesNotMatch(page, /AGENTXCHAIN_PAYLOAD_FILE/);
      assert.doesNotMatch(page, /Path to a temp JSON file/);
    });
  });

  describe('CLI docs page includes plugin commands', () => {
    it('cli.mdx has plugin in the command table', () => {
      const page = read('website-v2/docs/cli.mdx');
      assert.match(page, /plugin/);
    });
  });

  describe('sidebar includes plugins', () => {
    it('sidebars.ts includes plugins', () => {
      const sidebars = read('website-v2/sidebars.ts');
      assert.match(sidebars, /plugins/i);
    });
  });

  describe('planning specs are aligned', () => {
    it('DOCS_SURFACE_SPEC.md lists the plugins page', () => {
      const spec = read('.planning/DOCS_SURFACE_SPEC.md');
      assert.match(spec, /\/docs\/plugins/);
    });

    it('STATIC_DOCS_ROUTING_SPEC.md is superseded and references Docusaurus', () => {
      const spec = read('.planning/STATIC_DOCS_ROUTING_SPEC.md');
      assert.match(spec, /SUPERSEDED/);
      assert.match(spec, /Docusaurus/);
    });

    it('LAUNCH_BRIEF.md lists plugin docs', () => {
      const brief = read('.planning/LAUNCH_BRIEF.md');
      assert.match(brief, /Docs: Plugins/);
    });

    it('PLUGIN_SYSTEM_PHASE1_SPEC.md exists', () => {
      assert.ok(existsSync(resolve(ROOT, '.planning/PLUGIN_SYSTEM_PHASE1_SPEC.md')));
    });
  });

  describe('rollback and failure modes are documented', () => {
    it('plugins.mdx documents failure cleanup', () => {
      const page = read('website-v2/docs/plugins.mdx');
      assert.match(page, /[Ff]ailure|[Pp]artial/);
    });

    it('plugins.mdx documents config_schema enforcement', () => {
      const page = read('website-v2/docs/plugins.mdx');
      assert.match(page, /config_schema/);
    });

    it('plugins.mdx documents atomic upgrade rollback', () => {
      const page = read('website-v2/docs/plugins.mdx');
      assert.match(page, /atomic/i);
      assert.match(page, /rollback|backup|restore/i);
    });

    it('plugins.mdx documents unsafe removal or path validation', () => {
      const page = read('website-v2/docs/plugins.mdx');
      assert.match(page, /remov/i);
    });

    it('plugins.mdx does not claim unsupported zip archives or retry behavior', () => {
      const page = read('website-v2/docs/plugins.mdx');
      assert.doesNotMatch(page, /zip/i);
      assert.doesNotMatch(page, /single retry/i);
    });
  });
});
