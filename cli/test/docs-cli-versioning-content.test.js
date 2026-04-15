import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_DOCS = readFileSync(join(__dirname, '..', '..', 'website-v2', 'docs', 'cli.mdx'), 'utf8');

describe('CLI docs versioning surface', () => {
  it('AT-PVS-005: validate docs distinguish protocol version from config generation', () => {
    assert.match(CLI_DOCS, /protocol version:\s+`v7`/i);
    assert.match(CLI_DOCS, /config generation:\s+`v4`/i);
    assert.match(CLI_DOCS, /config_schema_version/i);
  });

  it('AT-PVS-006: doctor docs avoid flattening governed repos to bare v4 shorthand', () => {
    assert.match(CLI_DOCS, /governed config-generation v4 projects/i);
    assert.match(CLI_DOCS, /config_version.*compatibility alias/i);
  });
});
