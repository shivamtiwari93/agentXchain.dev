import { resolve } from 'node:path';

import { buildRunExport } from '../lib/export.js';
import { safeWriteJson } from '../lib/safe-write.js';

export async function exportCommand(options) {
  const format = options.format || 'json';
  if (format !== 'json') {
    console.error(`Unsupported export format "${format}". Only "json" is supported in this slice.`);
    process.exitCode = 1;
    return;
  }

  let result;
  try {
    result = buildRunExport(process.cwd());
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
    const outputPath = resolve(process.cwd(), options.output);
    safeWriteJson(outputPath, result.export);
    console.log(`Exported governed run audit to ${options.output}`);
    return;
  }

  console.log(JSON.stringify(result.export, null, 2));
}
