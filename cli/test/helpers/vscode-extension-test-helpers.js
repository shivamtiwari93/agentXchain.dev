import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const EXTENSION_ROOT = join(ROOT, 'cli', 'vscode-extension');
const LOCK_DIR = join(EXTENSION_ROOT, '.test-compile-lock');
const LOCK_TIMEOUT_MS = 60_000;
const LOCK_POLL_MS = 100;

function sourcePathFor(relativeOutFile) {
  return join(EXTENSION_ROOT, 'src', relativeOutFile.replace(/\.js$/, '.ts'));
}

function outPathFor(relativeOutFile) {
  return join(EXTENSION_ROOT, 'out', relativeOutFile);
}

function shouldCompile(relativeOutFiles) {
  return relativeOutFiles.some((relativeOutFile) => {
    const sourcePath = sourcePathFor(relativeOutFile);
    const outPath = outPathFor(relativeOutFile);
    if (!existsSync(outPath)) {
      return true;
    }
    return statSync(outPath).mtimeMs < statSync(sourcePath).mtimeMs;
  });
}

async function waitForCompileRelease(relativeOutFiles) {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (existsSync(LOCK_DIR)) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for VS Code extension compile lock to clear.');
    }
    await delay(LOCK_POLL_MS);
  }

  for (const relativeOutFile of relativeOutFiles) {
    const outPath = outPathFor(relativeOutFile);
    if (!existsSync(outPath)) {
      throw new Error(`Expected compiled VS Code extension output missing: ${outPath}`);
    }
  }
}

export async function ensureVsCodeExtensionCompiled(relativeOutFiles = ['governedStatus.js']) {
  if (!shouldCompile(relativeOutFiles)) {
    return;
  }

  try {
    mkdirSync(LOCK_DIR);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      await waitForCompileRelease(relativeOutFiles);
      return;
    }
    throw error;
  }

  try {
    execFileSync('npm', ['run', 'compile'], {
      cwd: EXTENSION_ROOT,
      stdio: 'ignore',
    });
  } finally {
    rmSync(LOCK_DIR, { recursive: true, force: true });
  }
}

export async function importCompiledVsCodeExtensionModule(relativeOutFile) {
  await ensureVsCodeExtensionCompiled([relativeOutFile]);
  return import(pathToFileURL(outPathFor(relativeOutFile)).href);
}
