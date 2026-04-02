import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'fs';
import { createHash } from 'crypto';
import { join, resolve, relative } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';

import { loadProjectContext, CONFIG_FILE } from './config.js';
import { validateHooksConfig } from './hook-runner.js';
import { safeWriteJson } from './safe-write.js';

export const PLUGIN_MANIFEST_FILE = 'agentxchain-plugin.json';
export const PLUGINS_DIR = '.agentxchain/plugins';
const PLUGIN_SCHEMA_VERSION = '0.1';
const PLUGIN_NAME_RE = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function sanitizePluginName(name) {
  const readable = name
    .replace(/^@/, '')
    .replace(/\//g, '--')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'plugin';
  const suffix = createHash('sha1').update(name).digest('hex').slice(0, 8);
  return `${readable}--${suffix}`;
}

function ensureGovernedProject(startDir) {
  const project = loadProjectContext(startDir);
  if (!project) {
    return { ok: false, error: 'No governed project found. Run this inside an AgentXchain project.' };
  }
  if (project.version !== 4) {
    return { ok: false, error: 'Plugin commands only support governed projects.' };
  }
  return { ok: true, project };
}

function cleanupTempDir(tempDir) {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function cleanupEmptyPluginsDir(projectRoot) {
  const pluginsRoot = join(projectRoot, PLUGINS_DIR);
  if (!existsSync(pluginsRoot)) {
    return;
  }

  if (readdirSync(pluginsRoot).length === 0) {
    rmSync(pluginsRoot, { recursive: true, force: true });
  }
}

function findManifestRoot(baseDir) {
  const direct = join(baseDir, PLUGIN_MANIFEST_FILE);
  if (existsSync(direct)) {
    return baseDir;
  }

  const packageRoot = join(baseDir, 'package');
  if (existsSync(join(packageRoot, PLUGIN_MANIFEST_FILE))) {
    return packageRoot;
  }

  return null;
}

function extractArchive(archivePath) {
  const tempDir = mkdtempSync(join(tmpdir(), 'axc-plugin-'));
  const extract = spawnSync('tar', ['-xzf', archivePath, '-C', tempDir], {
    encoding: 'utf8',
    timeout: 30000,
  });

  if (extract.status !== 0) {
    cleanupTempDir(tempDir);
    return {
      ok: false,
      error: `Failed to extract plugin archive: ${(extract.stderr || extract.stdout || 'tar failed').trim()}`,
    };
  }

  const root = findManifestRoot(tempDir);
  if (!root) {
    cleanupTempDir(tempDir);
    return { ok: false, error: `Missing ${PLUGIN_MANIFEST_FILE} in extracted archive.` };
  }

  return {
    ok: true,
    type: 'archive',
    root,
    cleanup: () => cleanupTempDir(tempDir),
  };
}

function packNpmPlugin(spec) {
  const tempDir = mkdtempSync(join(tmpdir(), 'axc-plugin-pack-'));
  const pack = spawnSync('npm', ['pack', spec, '--silent'], {
    cwd: tempDir,
    encoding: 'utf8',
    timeout: 60000,
  });

  if (pack.status !== 0) {
    cleanupTempDir(tempDir);
    return {
      ok: false,
      error: `npm pack failed for "${spec}": ${(pack.stderr || pack.stdout || 'unknown error').trim()}`,
    };
  }

  const tarball = (pack.stdout || '')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .pop();

  if (!tarball) {
    cleanupTempDir(tempDir);
    return { ok: false, error: `npm pack produced no tarball for "${spec}"` };
  }

  const extracted = extractArchive(join(tempDir, tarball));
  if (!extracted.ok) {
    cleanupTempDir(tempDir);
    return extracted;
  }

  return {
    ok: true,
    type: 'npm_package',
    root: extracted.root,
    cleanup: () => {
      extracted.cleanup?.();
      cleanupTempDir(tempDir);
    },
  };
}

function resolvePluginSource(spec, startDir) {
  const resolvedPath = resolve(startDir, spec);
  if (existsSync(resolvedPath)) {
    const stats = statSync(resolvedPath);
    if (stats.isDirectory()) {
      const root = findManifestRoot(resolvedPath);
      if (!root) {
        return { ok: false, error: `Missing ${PLUGIN_MANIFEST_FILE} in ${resolvedPath}` };
      }

      return {
        ok: true,
        type: 'local_path',
        root,
        sourceSpec: spec,
        cleanup: null,
      };
    }

    if (stats.isFile() && (resolvedPath.endsWith('.tgz') || resolvedPath.endsWith('.tar.gz'))) {
      const extracted = extractArchive(resolvedPath);
      if (!extracted.ok) {
        return extracted;
      }
      return {
        ...extracted,
        sourceSpec: spec,
      };
    }
  }

  const packed = packNpmPlugin(spec);
  if (!packed.ok) {
    return packed;
  }

  return {
    ...packed,
    sourceSpec: spec,
  };
}

export function validatePluginManifest(manifest, sourceRoot) {
  const errors = [];

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, errors: ['plugin manifest must be a JSON object'] };
  }

  if (manifest.schema_version !== PLUGIN_SCHEMA_VERSION) {
    errors.push(`schema_version must be "${PLUGIN_SCHEMA_VERSION}"`);
  }

  if (typeof manifest.name !== 'string' || !manifest.name.trim()) {
    errors.push('name must be a non-empty string');
  } else if (!PLUGIN_NAME_RE.test(manifest.name)) {
    errors.push('name must be a valid package-style identifier');
  }

  if (typeof manifest.version !== 'string' || !manifest.version.trim()) {
    errors.push('version must be a non-empty string');
  }

  if ('description' in manifest && manifest.description !== undefined && typeof manifest.description !== 'string') {
    errors.push('description must be a string when provided');
  }

  if (!manifest.hooks || typeof manifest.hooks !== 'object' || Array.isArray(manifest.hooks)) {
    errors.push('hooks must be an object');
  } else {
    const hookValidation = validateHooksConfig(manifest.hooks, sourceRoot || null);
    errors.push(...hookValidation.errors);
  }

  if ('config_schema' in manifest && manifest.config_schema !== undefined) {
    if (!manifest.config_schema || typeof manifest.config_schema !== 'object' || Array.isArray(manifest.config_schema)) {
      errors.push('config_schema must be an object when provided');
    }
  }

  return { ok: errors.length === 0, errors };
}

function rewriteCommandTokens(command, sourceRoot, installRoot, projectRoot) {
  return command.map((token) => {
    if (typeof token !== 'string') {
      return token;
    }
    if (!token.startsWith('./') && !token.startsWith('../')) {
      return token;
    }

    const sourcePath = resolve(sourceRoot, token);
    if (!existsSync(sourcePath)) {
      throw new Error(`Plugin command path does not exist: ${token}`);
    }

    const installPath = resolve(installRoot, relative(sourceRoot, sourcePath));
    return relative(projectRoot, installPath);
  });
}

function buildInstalledHooks(manifest, sourceRoot, installRoot, projectRoot) {
  const installedHooks = {};

  for (const [phase, hookList] of Object.entries(manifest.hooks || {})) {
    installedHooks[phase] = hookList.map((hookDef) => ({
      ...clone(hookDef),
      command: rewriteCommandTokens(hookDef.command, sourceRoot, installRoot, projectRoot),
    }));
  }

  return installedHooks;
}

function mergePluginHooks(existingHooks, pluginHooks) {
  const merged = clone(existingHooks || {});
  const collisions = [];

  for (const [phase, hookList] of Object.entries(pluginHooks || {})) {
    const current = Array.isArray(merged[phase]) ? clone(merged[phase]) : [];
    const existingNames = new Set(current.map((hook) => hook.name));

    for (const hook of hookList) {
      if (existingNames.has(hook.name)) {
        collisions.push({ phase, hook_name: hook.name });
        continue;
      }
      current.push(hook);
      existingNames.add(hook.name);
    }

    merged[phase] = current;
  }

  return { merged, collisions };
}

function buildPluginMetadata(manifest, installRelPath, sourceType, sourceSpec) {
  const hooks = {};
  for (const [phase, hookList] of Object.entries(manifest.hooks || {})) {
    hooks[phase] = hookList.map((hook) => hook.name);
  }

  return {
    schema_version: manifest.schema_version,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description || null,
    install_path: installRelPath,
    source: {
      type: sourceType,
      spec: sourceSpec,
    },
    installed_at: new Date().toISOString(),
    hooks,
    config_schema: manifest.config_schema || null,
  };
}

export function listInstalledPlugins(startDir = process.cwd()) {
  const governed = ensureGovernedProject(startDir);
  if (!governed.ok) {
    return governed;
  }

  const { project } = governed;
  const plugins = Object.entries(project.rawConfig.plugins || {}).map(([name, meta]) => ({
    name,
    version: meta.version || null,
    description: meta.description || null,
    install_path: meta.install_path || null,
    source: meta.source || null,
    hooks: meta.hooks || {},
    installed: meta.install_path ? existsSync(join(project.root, meta.install_path)) : false,
  }));

  return { ok: true, plugins };
}

export function installPlugin(spec, startDir = process.cwd()) {
  const governed = ensureGovernedProject(startDir);
  if (!governed.ok) {
    return governed;
  }

  const { project } = governed;
  const source = resolvePluginSource(spec, startDir);
  if (!source.ok) {
    return source;
  }

  let installAbsPath = null;
  let installRecorded = false;

  try {
    const manifestPath = join(source.root, PLUGIN_MANIFEST_FILE);
    const manifest = readJson(manifestPath);
    const manifestValidation = validatePluginManifest(manifest, source.root);
    if (!manifestValidation.ok) {
      return { ok: false, error: manifestValidation.errors.join('; '), errors: manifestValidation.errors };
    }

    if (project.rawConfig.plugins?.[manifest.name]) {
      return { ok: false, error: `Plugin "${manifest.name}" is already installed.` };
    }

    const installId = sanitizePluginName(manifest.name);
    const installRelPath = join(PLUGINS_DIR, installId);
    installAbsPath = join(project.root, installRelPath);

    if (existsSync(installAbsPath)) {
      return { ok: false, error: `Install path already exists: ${installRelPath}` };
    }

    cpSync(source.root, installAbsPath, { recursive: true, force: false });

    const installedHooks = buildInstalledHooks(manifest, source.root, installAbsPath, project.root);
    const mergedHooks = mergePluginHooks(project.rawConfig.hooks || {}, installedHooks);
    if (mergedHooks.collisions.length > 0) {
      return {
        ok: false,
        error: `Plugin hook conflicts with existing config: ${mergedHooks.collisions.map((c) => `${c.phase}:${c.hook_name}`).join(', ')}`,
        collisions: mergedHooks.collisions,
      };
    }

    const hookValidation = validateHooksConfig(mergedHooks.merged, project.root);
    if (!hookValidation.ok) {
      return { ok: false, error: hookValidation.errors.join('; '), errors: hookValidation.errors };
    }

    const nextConfig = clone(project.rawConfig);
    nextConfig.hooks = mergedHooks.merged;
    nextConfig.plugins = {
      ...(nextConfig.plugins || {}),
      [manifest.name]: buildPluginMetadata(manifest, installRelPath, source.type, source.sourceSpec),
    };

    safeWriteJson(join(project.root, CONFIG_FILE), nextConfig);
    installRecorded = true;

    return {
      ok: true,
      action: 'installed',
      name: manifest.name,
      version: manifest.version,
      install_path: installRelPath,
      hooks: nextConfig.plugins[manifest.name].hooks,
      source: nextConfig.plugins[manifest.name].source,
    };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  } finally {
    if (!installRecorded && installAbsPath && existsSync(installAbsPath)) {
      rmSync(installAbsPath, { recursive: true, force: true });
      cleanupEmptyPluginsDir(project.root);
    }

    source.cleanup?.();
  }
}

export function removePlugin(name, startDir = process.cwd()) {
  const governed = ensureGovernedProject(startDir);
  if (!governed.ok) {
    return governed;
  }

  const { project } = governed;
  const pluginMeta = project.rawConfig.plugins?.[name];
  if (!pluginMeta) {
    return { ok: false, error: `Plugin "${name}" is not installed.` };
  }

  const installRelPath = pluginMeta.install_path;
  if (
    typeof installRelPath !== 'string'
    || (!installRelPath.startsWith(`${PLUGINS_DIR}/`) && installRelPath !== PLUGINS_DIR)
  ) {
    return { ok: false, error: `Refusing to remove unsafe plugin path: ${installRelPath || 'missing path'}` };
  }

  const nextConfig = clone(project.rawConfig);
  const pluginHooks = pluginMeta.hooks || {};

  for (const [phase, hookNames] of Object.entries(pluginHooks)) {
    if (!Array.isArray(nextConfig.hooks?.[phase])) {
      continue;
    }
    nextConfig.hooks[phase] = nextConfig.hooks[phase].filter((hook) => !hookNames.includes(hook.name));
    if (nextConfig.hooks[phase].length === 0) {
      delete nextConfig.hooks[phase];
    }
  }

  delete nextConfig.plugins[name];
  if (Object.keys(nextConfig.plugins).length === 0) {
    delete nextConfig.plugins;
  }

  safeWriteJson(join(project.root, CONFIG_FILE), nextConfig);
  rmSync(join(project.root, installRelPath), { recursive: true, force: true });
  cleanupEmptyPluginsDir(project.root);

  return {
    ok: true,
    action: 'removed',
    name,
    removed_hooks: pluginHooks,
    install_path: installRelPath,
  };
}
