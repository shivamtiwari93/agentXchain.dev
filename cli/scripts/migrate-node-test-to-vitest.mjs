#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url));
const CLI_ROOT = join(SCRIPT_DIR, '..');
const TEST_ROOT = process.argv[2] ? resolve(process.argv[2]) : join(CLI_ROOT, 'test');

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(absolute));
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      files.push(absolute);
    }
  }
  return files;
}

function parseNamedSpecifiers(specifiers) {
  return specifiers
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function migrateNamedSpecifiers(specifiers) {
  let importsBefore = false;
  let importsAfter = false;
  const migrated = parseNamedSpecifiers(specifiers).map((specifier) => {
    if (specifier === 'before') {
      importsBefore = true;
      return 'beforeAll';
    }
    if (specifier === 'after') {
      importsAfter = true;
      return 'afterAll';
    }
    return specifier;
  });
  return {
    importsBefore,
    importsAfter,
    importLine: `import { ${migrated.join(', ')} } from 'vitest';`,
  };
}

function migrateSource(source) {
  let importsBefore = false;
  let importsAfter = false;
  let changed = false;

  let next = source.replace(
    /^import\s+test\s+from\s+['"]node:test['"];$/gm,
    () => {
      changed = true;
      return "import { test } from 'vitest';";
    },
  );

  next = next.replace(
    /^import\s+\{([^}]+)\}\s+from\s+['"]node:test['"];$/gm,
    (_match, specifiers) => {
      const migrated = migrateNamedSpecifiers(specifiers);
      importsBefore ||= migrated.importsBefore;
      importsAfter ||= migrated.importsAfter;
      changed = true;
      return migrated.importLine;
    },
  );

  if (importsBefore) {
    next = next.replace(/\bbefore(?=\s*\()/g, 'beforeAll');
  }
  if (importsAfter) {
    next = next.replace(/\bafter(?=\s*\()/g, 'afterAll');
  }

  return { changed, source: next };
}

const changedFiles = [];
for (const file of walk(TEST_ROOT)) {
  const source = readFileSync(file, 'utf8');
  const migrated = migrateSource(source);
  if (!migrated.changed || migrated.source === source) continue;
  writeFileSync(file, migrated.source);
  changedFiles.push(relative(CLI_ROOT, file));
}

console.log(`Migrated ${changedFiles.length} test files from node:test to vitest.`);
for (const file of changedFiles) {
  console.log(file);
}
