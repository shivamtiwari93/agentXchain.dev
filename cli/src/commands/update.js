import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import chalk from 'chalk';

export async function updateCommand() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));
  const currentVersion = pkg.version;

  console.log('');
  console.log(`  ${chalk.dim('Current version:')} ${currentVersion}`);
  console.log(`  ${chalk.dim('Checking npm for latest...')}`);

  try {
    const latest = execSync('npm view agentxchain version', { encoding: 'utf8' }).trim();

    if (latest === currentVersion) {
      console.log(chalk.green(`  ✓ Already on the latest version (${currentVersion}).`));
      console.log('');
      return;
    }

    console.log(`  ${chalk.dim('Latest version:')}  ${chalk.cyan(latest)}`);
    console.log('');
    console.log(`  Updating...`);

    execSync('npm install -g agentxchain@latest', { stdio: 'inherit' });

    console.log('');
    console.log(chalk.green(`  ✓ Updated to ${latest}`));
    console.log('');
  } catch (err) {
    console.log('');
    console.log(chalk.yellow('  Could not auto-update. Run manually:'));
    console.log(`    ${chalk.bold('npm install -g agentxchain@latest')}`);
    console.log('');
    console.log(chalk.dim(`  Error: ${err.message}`));
    console.log('');
  }
}
