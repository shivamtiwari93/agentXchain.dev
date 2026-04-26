import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { buildRunExport, buildCoordinatorExport } from '../lib/export.js';
import { COORDINATOR_CONFIG_FILE } from '../lib/coordinator-config.js';
import { safeWriteJson } from '../lib/safe-write.js';

function detectExportKind(cwd) {
  // Governed project takes priority (agentxchain.json)
  if (existsSync(join(cwd, 'agentxchain.json'))) {
    return 'governed';
  }
  // Coordinator workspace (agentxchain-multi.json)
  if (existsSync(join(cwd, COORDINATOR_CONFIG_FILE))) {
    return 'coordinator';
  }
  return null;
}

export async function exportCommand(options) {
  const format = options.format || 'json';
  if (format !== 'json') {
    console.error(`Unsupported export format "${format}". Only "json" is supported in this slice.`);
    process.exitCode = 1;
    return;
  }

  const cwd = process.cwd();
  const kind = detectExportKind(cwd);

  // BUG-88: apply bounding to prevent Invalid string length on large accumulated state
  const defaultExportOpts = { maxJsonlEntries: 1000, maxBase64Bytes: 1024 * 1024, maxExportFiles: 500, maxTextDataBytes: 131072, maxJsonDataBytes: 262144 };

  let result;
  try {
    if (kind === 'governed') {
      result = buildRunExport(cwd, defaultExportOpts);
    } else if (kind === 'coordinator') {
      result = buildCoordinatorExport(cwd);
    } else {
      result = {
        ok: false,
        error: 'No governed project or coordinator workspace found. Run this inside an AgentXchain governed project or coordinator workspace.',
      };
    }
  } catch (error) {
    console.error(error.message || String(error));
    process.exitCode = 1;
    return;
  }

  if (!result.ok) {
    console.error(result.error);
    process.exitCode = 1;
    return;
  }

  if (options.output) {
    const outputPath = resolve(cwd, options.output);
    safeWriteJson(outputPath, result.export);
    console.log(`Exported ${kind === 'coordinator' ? 'coordinator workspace' : 'governed run'} audit to ${options.output}`);
    return;
  }

  // BUG-88: compact JSON to avoid string-length overflow on large exports
  try {
    console.log(JSON.stringify(result.export));
  } catch (serializeErr) {
    if (/Invalid string length/i.test(serializeErr.message)) {
      // Retry with tighter bounds
      const tightOpts = { maxJsonlEntries: 500, maxBase64Bytes: 65536, maxExportFiles: 200, maxTextDataBytes: 32768, maxJsonDataBytes: 65536 };
      const tightResult = buildRunExport(cwd, tightOpts);
      if (tightResult.ok) {
        console.log(JSON.stringify(tightResult.export));
      } else {
        console.error(tightResult.error || serializeErr.message);
        process.exitCode = 1;
      }
    } else {
      throw serializeErr;
    }
  }
}
