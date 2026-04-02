import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

describe('Plugin docs surface', () => {

  describe('published docs page exists', () => {
    it('plugins.html exists', () => {
      assert.ok(existsSync(resolve(ROOT, 'website/docs/plugins.html')));
    });

    it('plugins.html documents the manifest format', () => {
      const page = read('website/docs/plugins.html');
      assert.match(page, /agentxchain-plugin\.json/);
      assert.match(page, /schema_version/);
      assert.match(page, /hooks/);
    });

    it('plugins.html documents install, list, and remove', () => {
      const page = read('website/docs/plugins.html');
      assert.match(page, /plugin install/);
      assert.match(page, /plugin list/);
      assert.match(page, /plugin remove/);
    });

    it('plugins.html documents collision protection', () => {
      const page = read('website/docs/plugins.html');
      assert.match(page, /collision/i);
    });

    it('plugins.html documents path rewriting', () => {
      const page = read('website/docs/plugins.html');
      assert.match(page, /rewrite|rewriting/i);
    });
  });

  describe('CLI docs page includes plugin commands', () => {
    it('cli.html has plugin install in the command table', () => {
      const page = read('website/docs/cli.html');
      assert.match(page, /plugin install/);
    });

    it('cli.html has plugin list in the command table', () => {
      const page = read('website/docs/cli.html');
      assert.match(page, /plugin list/);
    });

    it('cli.html has plugin remove in the command table', () => {
      const page = read('website/docs/cli.html');
      assert.match(page, /plugin remove/);
    });

    it('cli.html has a plugins section', () => {
      const page = read('website/docs/cli.html');
      assert.match(page, /id="plugins"/);
    });
  });

  describe('navigation includes plugins link', () => {
    const docsPages = [
      'website/docs/quickstart.html',
      'website/docs/adapters.html',
      'website/docs/cli.html',
      'website/docs/plugins.html',
      'website/docs/protocol.html',
      'website/docs/protocol-v6.html',
    ];

    for (const page of docsPages) {
      it(`${page} nav links to plugins.html`, () => {
        const content = read(page);
        assert.match(content, /href="\/docs\/plugins\.html"/);
      });
    }
  });

  describe('planning specs are aligned', () => {
    it('DOCS_SURFACE_SPEC.md lists the plugins page', () => {
      const spec = read('.planning/DOCS_SURFACE_SPEC.md');
      assert.match(spec, /\/docs\/plugins/);
    });

    it('STATIC_DOCS_ROUTING_SPEC.md lists plugins.html', () => {
      const spec = read('.planning/STATIC_DOCS_ROUTING_SPEC.md');
      assert.match(spec, /plugins\.html/);
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
    it('plugins.html documents partial install failure cleanup', () => {
      const page = read('website/docs/plugins.html');
      assert.match(page, /[Pp]artial install|staged.*clean/);
    });

    it('plugins.html documents unsafe removal path rejection', () => {
      const page = read('website/docs/plugins.html');
      assert.match(page, /[Uu]nsafe.*removal|outside.*plugins/);
    });
  });
});
