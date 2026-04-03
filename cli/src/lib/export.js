import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { loadProjectContext, loadProjectState } from './config.js';

const INCLUDED_ROOTS = [
  'agentxchain.json',
  '.agentxchain/state.json',
  '.agentxchain/history.jsonl',
  '.agentxchain/decision-ledger.jsonl',
  '.agentxchain/hook-audit.jsonl',
  '.agentxchain/hook-annotations.jsonl',
  '.agentxchain/dispatch',
  '.agentxchain/staging',
  '.agentxchain/transactions/accept',
  '.agentxchain/intake',
  '.agentxchain/multirepo',
];

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function collectPaths(root, relPath) {
  const absPath = join(root, relPath);
  if (!existsSync(absPath)) {
    return [];
  }

  const stats = statSync(absPath);
  if (stats.isFile()) {
    return [relPath];
  }

  if (!stats.isDirectory()) {
    return [];
  }

  const entries = readdirSync(absPath, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));

  const files = [];
  for (const entry of entries) {
    const childRelPath = `${relPath}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...collectPaths(root, childRelPath));
    } else if (entry.isFile()) {
      files.push(childRelPath);
    }
  }
  return files;
}

function parseJsonl(relPath, raw) {
  if (!raw.trim()) {
    return [];
  }

  return raw
    .split('\n')
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${relPath}: invalid JSONL at line ${index + 1}: ${error.message}`);
      }
    });
}

function parseFile(root, relPath) {
  const absPath = join(root, relPath);
  const buffer = readFileSync(absPath);
  const raw = buffer.toString('utf8');

  let format = 'text';
  let data = raw;

  if (relPath.endsWith('.json')) {
    try {
      data = JSON.parse(raw);
      format = 'json';
    } catch (error) {
      throw new Error(`${relPath}: invalid JSON: ${error.message}`);
    }
  } else if (relPath.endsWith('.jsonl')) {
    data = parseJsonl(relPath, raw);
    format = 'jsonl';
  }

  return {
    format,
    bytes: buffer.byteLength,
    sha256: sha256(buffer),
    data,
  };
}

function countJsonl(files, relPath) {
  return Array.isArray(files[relPath]?.data) ? files[relPath].data.length : 0;
}

function countDirectoryFiles(files, prefix) {
  return Object.keys(files).filter((path) => path.startsWith(`${prefix}/`)).length;
}

export function buildRunExport(startDir = process.cwd()) {
  const context = loadProjectContext(startDir);
  if (!context) {
    return {
      ok: false,
      error: 'No governed project found. Run this inside an AgentXchain governed project.',
    };
  }

  if (context.config.protocol_mode !== 'governed') {
    return {
      ok: false,
      error: 'Run export only supports governed projects in this slice.',
    };
  }

  const { root, rawConfig, config, version } = context;
  const state = loadProjectState(root, config);

  const collectedPaths = [...new Set(INCLUDED_ROOTS.flatMap((relPath) => collectPaths(root, relPath)))]
    .sort((a, b) => a.localeCompare(b, 'en'));

  const files = {};
  for (const relPath of collectedPaths) {
    files[relPath] = parseFile(root, relPath);
  }

  const activeTurns = Object.keys(state?.active_turns || {}).sort((a, b) => a.localeCompare(b, 'en'));
  const retainedTurns = Object.keys(state?.retained_turns || {}).sort((a, b) => a.localeCompare(b, 'en'));

  return {
    ok: true,
    export: {
      schema_version: '0.1',
      export_kind: 'agentxchain_run_export',
      exported_at: new Date().toISOString(),
      project_root: relative(process.cwd(), root) || '.',
      project: {
        id: config.project.id,
        name: config.project.name,
        template: config.template || 'generic',
        protocol_mode: config.protocol_mode,
        schema_version: version,
      },
      summary: {
        run_id: state?.run_id || null,
        status: state?.status || null,
        phase: state?.phase || null,
        active_turn_ids: activeTurns,
        retained_turn_ids: retainedTurns,
        history_entries: countJsonl(files, '.agentxchain/history.jsonl'),
        decision_entries: countJsonl(files, '.agentxchain/decision-ledger.jsonl'),
        hook_audit_entries: countJsonl(files, '.agentxchain/hook-audit.jsonl'),
        dispatch_artifact_files: countDirectoryFiles(files, '.agentxchain/dispatch'),
        staging_artifact_files: countDirectoryFiles(files, '.agentxchain/staging'),
        intake_present: Object.keys(files).some((path) => path.startsWith('.agentxchain/intake/')),
        coordinator_present: Object.keys(files).some((path) => path.startsWith('.agentxchain/multirepo/')),
      },
      files,
      config: rawConfig,
      state,
    },
  };
}
