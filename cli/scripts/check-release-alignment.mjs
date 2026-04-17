#!/usr/bin/env node

import process from 'node:process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RELEASE_ALIGNMENT_SCOPES,
  validateReleaseAlignment,
} from '../src/lib/release-alignment.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function usage() {
  console.error('Usage: node cli/scripts/check-release-alignment.mjs [--target-version <semver>] [--scope prebump|current] [--json]');
}

let targetVersion = null;
let scope = RELEASE_ALIGNMENT_SCOPES.CURRENT;
let json = false;

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === '--target-version') {
    targetVersion = process.argv[index + 1] || null;
    if (!targetVersion) {
      console.error('Error: --target-version requires a semver argument');
      usage();
      process.exit(1);
    }
    index += 1;
    continue;
  }
  if (arg === '--scope') {
    scope = process.argv[index + 1] || '';
    if (!Object.values(RELEASE_ALIGNMENT_SCOPES).includes(scope)) {
      console.error(`Error: invalid --scope "${scope}"`);
      usage();
      process.exit(1);
    }
    index += 1;
    continue;
  }
  if (arg === '--json') {
    json = true;
    continue;
  }
  console.error(`Error: unknown argument "${arg}"`);
  usage();
  process.exit(1);
}

const result = validateReleaseAlignment(REPO_ROOT, { targetVersion, scope });

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.ok) {
  console.log(`Release alignment OK for ${result.targetVersion} (${result.scope}, ${result.checkedSurfaceCount} surfaces).`);
} else {
  console.error(`Release alignment FAILED for ${result.targetVersion} (${result.scope}, ${result.errors.length} issue(s)).`);
  for (const error of result.errors) {
    console.error(`- [${error.surface_id}] ${error.message}`);
  }
}

process.exit(result.ok ? 0 : 1);
