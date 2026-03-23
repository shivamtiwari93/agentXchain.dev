import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import chalk from 'chalk';

function printGlobalInstallFallbacks() {
  console.log(chalk.dim('  If global install failed with permission errors (EACCES):'));
  console.log(`    ${chalk.bold('sudo npm install -g agentxchain@latest')}  ${chalk.dim('(macOS/Linux)')}`);
  console.log(`    ${chalk.bold('npm config get prefix')}  ${chalk.dim('— fix ownership of that directory, or use a user prefix:')}`);
  console.log(`    ${chalk.bold('mkdir -p ~/.npm-global && npm config set prefix ~/.npm-global')}`);
  console.log(`    ${chalk.dim('(add ~/.npm-global/bin to PATH)')}`);
  console.log(chalk.dim('  Or run without global install:'));
  console.log(`    ${chalk.bold('npx agentxchain@latest <command>')}`);
  console.log('');
  console.log(chalk.dim('  Node: use 18.17+ or 20.5+ to avoid engine warnings from dependencies.'));
  console.log('');
}

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
    console.log('  Updating...');

    try {
      execSync('npm install -g agentxchain@latest', { stdio: 'inherit' });
    } catch {
      console.log('');
      console.log(chalk.yellow('  Global install failed. Common fixes:'));
      printGlobalInstallFallbacks();
      return;
    }

    console.log('');
    console.log(chalk.green(`  ✓ Updated to ${latest}`));
    console.log('');
  } catch (err) {
    console.log('');
    console.log(chalk.yellow('  Could not check or install the latest version.'));
    console.log(`    ${chalk.bold('npm install -g agentxchain@latest')}`);
    console.log('');
    printGlobalInstallFallbacks();
    console.log(chalk.dim(`  Error: ${err.message}`));
    console.log('');
  }
}
