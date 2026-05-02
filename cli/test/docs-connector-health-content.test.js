import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const CLI_DOCS = readFileSync(join(REPO_ROOT, 'website-v2', 'docs', 'cli.mdx'), 'utf8');
const STATUS_SOURCE = readFileSync(join(REPO_ROOT, 'cli', 'src', 'commands', 'status.js'), 'utf8');
const BRIDGE_SERVER = readFileSync(join(REPO_ROOT, 'cli', 'src', 'lib', 'dashboard', 'bridge-server.js'), 'utf8');
const DASHBOARD_APP = readFileSync(join(REPO_ROOT, 'cli', 'dashboard', 'app.js'), 'utf8');
const TIMELINE_COMPONENT = readFileSync(join(REPO_ROOT, 'cli', 'dashboard', 'components', 'timeline.js'), 'utf8');
const CONNECTOR_HEALTH_SPEC = readFileSync(join(REPO_ROOT, '.planning', 'CONNECTOR_HEALTH_SURFACE_SPEC.md'), 'utf8');

describe('connector health docs/content surface', () => {
  it('AT-DOC-CH-001: status docs describe the additive connector health surface truthfully', () => {
    assert.ok(CLI_DOCS.includes('connector_health'), 'cli docs must mention connector_health');
    assert.ok(CLI_DOCS.includes('Connectors:'), 'cli docs must mention the human-readable connector section');
    assert.ok(CLI_DOCS.includes('/api/connectors'), 'cli docs must mention the dashboard connector endpoint');
    assert.ok(CLI_DOCS.includes('Connector Health'), 'cli docs must mention the Timeline connector panel');
    assert.ok(STATUS_SOURCE.includes('connector_health: connectorHealth'), 'status --json must expose connector_health');
    assert.ok(STATUS_SOURCE.includes("Connectors:'"), 'human-readable status must render Connectors section');
    assert.ok(BRIDGE_SERVER.includes('/api/connectors'), 'dashboard bridge must expose /api/connectors');
    assert.ok(DASHBOARD_APP.includes("connectors: '/api/connectors'"), 'dashboard app must fetch connector data');
    assert.ok(TIMELINE_COMPONENT.includes('Connector Health'), 'timeline component must render connector health');
  });

  it('ships a durable connector health spec', () => {
    assert.match(CONNECTOR_HEALTH_SPEC, /Connector Health Surface Spec/);
    assert.match(CONNECTOR_HEALTH_SPEC, /AT-CHS-001/);
    assert.match(CONNECTOR_HEALTH_SPEC, /AT-DASH-CH-001/);
    assert.match(CONNECTOR_HEALTH_SPEC, /GET \/api\/connectors/);
  });
});
