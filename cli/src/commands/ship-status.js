/**
 * CLI command: agentxchain ship-status
 *
 * Answers "is this ready to ship?" by composing five evidence dimensions into a
 * single ShipStatusReport. All evaluation logic lives in lib/ship-status.js — this
 * command is presentation only (Architecture Invariant #5).
 */

import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import chalk from 'chalk';
import { findProjectRoot } from '../lib/config.js';
import { COORDINATOR_CONFIG_FILE } from '../lib/coordinator-config.js';
import { evaluateShipStatus, evaluateCoordinatorShipStatus } from '../lib/ship-status.js';

function statusIcon(status) {
  if (status === 'pass') return chalk.green('✓');
  if (status === 'fail') return chalk.red('✗');
  return chalk.yellow('?');
}

function overallLabel(overall) {
  if (overall === 'pass') return chalk.green.bold('YES');
  if (overall === 'fail') return chalk.red.bold('NO');
  return chalk.yellow.bold('PENDING');
}

function countPassed(report) {
  return (report.dimensions || []).filter((d) => d.status === 'pass').length;
}

function printDimensions(dimensions, indent) {
  for (const dim of dimensions || []) {
    console.log(`${indent}${statusIcon(dim.status)}  ${dim.name}: ${dim.detail}`);
  }
}

function printSingle(report, opts) {
  const passed = countPassed(report);
  const total = (report.dimensions || []).length;
  const blocking = report.blocking_reasons || [];
  const suffix = blocking.length ? `, ${blocking.length} blocking` : '';
  console.log(`\nShip Status: ${overallLabel(report.overall)} (${passed}/${total} dimensions pass${suffix})`);

  if (opts.verbose) {
    console.log('');
    printDimensions(report.dimensions, '  ');
  } else {
    for (const reason of blocking) {
      console.log(`  ${chalk.dim('-')} ${reason}`);
    }
  }
  console.log('');
}

export async function shipStatusCommand(opts) {
  const dir = opts.dir ? resolve(opts.dir) : process.cwd();
  const coordinatorConfigPath = join(dir, COORDINATOR_CONFIG_FILE);

  let report;
  let isCoordinator = false;

  if (existsSync(coordinatorConfigPath)) {
    isCoordinator = true;
    report = evaluateCoordinatorShipStatus(dir);
  } else {
    const root = findProjectRoot(dir);
    if (!root) {
      console.error(chalk.red('No agentxchain project found. Run "agentxchain init" first.'));
      process.exitCode = 1;
      return;
    }
    report = evaluateShipStatus(root);
  }

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (isCoordinator) {
    const blocking = report.blocking_repos || [];
    const total = (report.repos || []).length;
    const shippable = total - blocking.length;
    console.log(`\nCoordinator Ship Status: ${overallLabel(report.overall)} (${shippable}/${total} repos shippable)`);
    for (const entry of report.repos || []) {
      const passed = countPassed(entry.ship_status);
      const dimTotal = (entry.ship_status.dimensions || []).length;
      console.log(`\n  ${chalk.bold(entry.repo_id)}: ${overallLabel(entry.ship_status.overall)} (${passed}/${dimTotal})`);
      if (opts.verbose) {
        printDimensions(entry.ship_status.dimensions, '    ');
      } else {
        for (const reason of entry.ship_status.blocking_reasons || []) {
          console.log(`    ${chalk.dim('-')} ${reason}`);
        }
      }
    }
    console.log('');
  } else {
    printSingle(report, opts);
  }

  // Non-zero exit when not shippable (useful for CI gating).
  if (report.overall === 'fail') {
    process.exitCode = 1;
  }
}
