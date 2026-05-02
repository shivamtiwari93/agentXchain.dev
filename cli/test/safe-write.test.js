import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { readFileSync, readdirSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeWriteJson, safeWriteText } from '../src/lib/safe-write.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, '.tmp-safe-write-test');

function setup() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
}

function cleanup() {
  rmSync(TMP, { recursive: true, force: true });
}

describe('safeWriteJson', () => {
  it('writes valid JSON that can be read back', () => {
    setup();
    const filePath = join(TMP, 'test.json');
    const data = { holder: 'pm', turn_number: 5 };
    safeWriteJson(filePath, data);
    const read = JSON.parse(readFileSync(filePath, 'utf8'));
    assert.deepEqual(read, data);
    cleanup();
  });

  it('overwrites existing file atomically', () => {
    setup();
    const filePath = join(TMP, 'test.json');
    safeWriteJson(filePath, { v: 1 });
    safeWriteJson(filePath, { v: 2 });
    const read = JSON.parse(readFileSync(filePath, 'utf8'));
    assert.equal(read.v, 2);
    cleanup();
  });

  it('leaves no temp files after successful write', () => {
    setup();
    const filePath = join(TMP, 'test.json');
    safeWriteJson(filePath, { ok: true });
    const files = readdirSync(TMP);
    assert.equal(files.length, 1);
    assert.equal(files[0], 'test.json');
    cleanup();
  });

  it('creates parent directories if needed', () => {
    setup();
    const filePath = join(TMP, 'sub', 'dir', 'test.json');
    safeWriteJson(filePath, { nested: true });
    assert.ok(existsSync(filePath));
    cleanup();
  });
});

describe('safeWriteText', () => {
  it('writes text that can be read back', () => {
    setup();
    const filePath = join(TMP, 'test.md');
    safeWriteText(filePath, '# Hello\n');
    const read = readFileSync(filePath, 'utf8');
    assert.equal(read, '# Hello\n');
    cleanup();
  });
});
