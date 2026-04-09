import { readFileSync } from 'node:fs';
import { lintDecisionLog, formatHumanReport } from './lint.js';

const USAGE = `Usage:
  decision-log-linter lint <file> [--json]
`;

export function runCli(argv, deps = {}) {
  const stdout = deps.stdout || process.stdout;
  const stderr = deps.stderr || process.stderr;
  const readFile = deps.readFile || ((filePath) => readFileSync(filePath, 'utf8'));

  if (!Array.isArray(argv) || argv.length < 2 || argv[0] !== 'lint') {
    stderr.write(USAGE);
    return 2;
  }

  const filePath = argv[1];
  const jsonMode = argv.includes('--json');

  let source;
  try {
    source = readFile(filePath);
  } catch (error) {
    stderr.write(`Unable to read "${filePath}": ${error.message}\n`);
    return 2;
  }

  const result = lintDecisionLog(source);

  if (jsonMode) {
    stdout.write(`${JSON.stringify({ file: filePath, ...result }, null, 2)}\n`);
  } else {
    stdout.write(formatHumanReport(result, filePath));
  }

  return result.ok ? 0 : 1;
}
