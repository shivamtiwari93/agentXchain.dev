import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';

function parseEnvFile(raw) {
  const out = {};
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) out[key] = value;
  }

  return out;
}

export function hydrateEnvFromProject(root) {
  if (!root) return;

  const envPath = join(root, '.env');
  if (!existsSync(envPath)) return;

  try {
    const parsed = parseEnvFile(readFileSync(envPath, 'utf8'));
    for (const [k, v] of Object.entries(parsed)) {
      if (!process.env[k] && v !== undefined) process.env[k] = v;
    }
  } catch {
    // Non-fatal: commands still work with shell env vars.
  }
}

export function getCursorApiKey(root) {
  hydrateEnvFromProject(root);
  const key = process.env.CURSOR_API_KEY?.trim();
  return key || null;
}

export function printCursorApiKeyRequired(commandName = 'this command') {
  console.log('');
  console.log(chalk.red(`  CURSOR_API_KEY is required for ${commandName}.`));
  console.log(chalk.dim('  Set it once in your project root .env file:'));
  console.log(`  ${chalk.bold('CURSOR_API_KEY=your_key')}`);
  console.log(chalk.dim('  You can get a key from: cursor.com/settings -> Cloud Agents'));
  console.log('');
}
