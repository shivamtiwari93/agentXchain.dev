import chalk from 'chalk';
import { resolve } from 'node:path';
import { verifyProtocolConformance } from '../lib/protocol-conformance.js';

export async function verifyProtocolCommand(opts) {
  const target = opts.target ? resolve(opts.target) : process.cwd();
  const requestedTier = Number.parseInt(String(opts.tier || '1'), 10);
  const format = opts.format || 'text';

  let result;
  try {
    result = verifyProtocolConformance({
      targetRoot: target,
      requestedTier,
      surface: opts.surface || null,
    });
  } catch (error) {
    if (format === 'json') {
      console.log(JSON.stringify({
        overall: 'error',
        message: error.message,
      }, null, 2));
    } else {
      console.log(chalk.red(`Protocol verification failed: ${error.message}`));
    }
    process.exit(2);
  }

  if (format === 'json') {
    console.log(JSON.stringify(result.report, null, 2));
  } else {
    printProtocolReport(result.report);
  }

  process.exit(result.exitCode);
}

function printProtocolReport(report) {
  console.log('');
  console.log(chalk.bold('  AgentXchain Protocol Conformance'));
  console.log(chalk.dim('  ' + '─'.repeat(44)));
  console.log(chalk.dim(`  Target: ${report.target_root}`));
  console.log(chalk.dim(`  Implementation: ${report.implementation}`));
  console.log(chalk.dim(`  Tier requested: ${report.tier_requested}`));
  console.log('');

  const overallLabel = report.overall === 'pass'
    ? chalk.green('PASS')
    : report.overall === 'fail'
      ? chalk.red('FAIL')
      : chalk.red('ERROR');
  console.log(`  Overall: ${overallLabel}`);

  for (const [tierKey, tier] of Object.entries(report.results)) {
    const label = tier.status === 'pass'
      ? chalk.green('pass')
      : tier.status === 'skipped'
        ? chalk.yellow('skipped')
        : chalk.red(tier.status);
    const niCount = tier.fixtures_not_implemented || 0;
    const niSuffix = niCount > 0 ? chalk.yellow(`, ${niCount} not implemented`) : '';
    console.log(`  ${tierKey}: ${label} (${tier.fixtures_passed}/${tier.fixtures_run} passed${niSuffix})`);

    for (const ni of tier.not_implemented || []) {
      console.log(chalk.yellow(`    ○ ${ni.fixture_id}: ${ni.message}`));
    }
    for (const failure of tier.failures || []) {
      console.log(chalk.red(`    ✗ ${failure.fixture_id}: ${failure.message}`));
    }
    for (const error of tier.errors || []) {
      console.log(chalk.red(`    ✗ ${error.fixture_id}: ${error.message}`));
    }
  }

  console.log('');
}
