import chalk from 'chalk';
import { loadProjectContext } from '../lib/config.js';

export function roleCommand(subcommand, roleId, opts) {
  const context = loadProjectContext();
  if (!context) {
    console.log(chalk.red('  No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { rawConfig, version } = context;

  if (version !== 4) {
    console.log(chalk.red('  Not a governed AgentXchain project (requires v4 config).'));
    process.exit(1);
  }

  const roles = rawConfig.roles || {};
  const roleIds = Object.keys(roles);

  if (subcommand === 'show') {
    return showRole(roleId, roles, roleIds, opts);
  }

  // Default: list
  return listRoles(roles, roleIds, opts);
}

function listRoles(roles, roleIds, opts) {
  if (roleIds.length === 0) {
    if (opts.json) {
      console.log('[]');
    } else {
      console.log('  No roles defined.');
    }
    return;
  }

  if (opts.json) {
    const output = roleIds.map((id) => {
      const entry = {
        id,
        title: roles[id].title,
        mandate: roles[id].mandate,
        write_authority: roles[id].write_authority,
        runtime: roles[id].runtime,
      };
      if (typeof roles[id].decision_authority === 'number') {
        entry.decision_authority = roles[id].decision_authority;
      }
      return entry;
    });
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(chalk.bold(`\n  Roles (${roleIds.length}):\n`));
  for (const id of roleIds) {
    const r = roles[id];
    const authority = r.write_authority === 'authoritative'
      ? chalk.green(r.write_authority)
      : r.write_authority === 'proposed'
        ? chalk.yellow(r.write_authority)
        : chalk.dim(r.write_authority);
    const decAuth = typeof r.decision_authority === 'number' ? chalk.dim(` dec:${r.decision_authority}`) : '';
    console.log(`  ${chalk.cyan(id)} — ${r.title} [${authority}${decAuth}] → ${chalk.dim(r.runtime)}`);
  }
  console.log('');
  console.log(chalk.dim('  Usage: agentxchain role show <role_id>\n'));
}

function showRole(roleId, roles, roleIds, opts) {
  if (!roleId) {
    console.log(chalk.red('  Missing role ID.'));
    console.log(chalk.dim(`  Usage: agentxchain role show <role_id>`));
    if (roleIds.length > 0) {
      console.log(chalk.dim(`  Available: ${roleIds.join(', ')}`));
    }
    process.exit(1);
  }

  if (!roles[roleId]) {
    console.log(chalk.red(`  Unknown role: ${roleId}`));
    console.log(chalk.dim(`  Available: ${roleIds.join(', ')}`));
    process.exit(1);
  }

  const r = roles[roleId];

  if (opts.json) {
    const entry = {
      id: roleId,
      title: r.title,
      mandate: r.mandate,
      write_authority: r.write_authority,
      runtime: r.runtime,
    };
    if (typeof r.decision_authority === 'number') {
      entry.decision_authority = r.decision_authority;
    }
    console.log(JSON.stringify(entry, null, 2));
    return;
  }

  const authority = r.write_authority === 'authoritative'
    ? chalk.green(r.write_authority)
    : r.write_authority === 'proposed'
      ? chalk.yellow(r.write_authority)
      : chalk.dim(r.write_authority);

  console.log(chalk.bold(`\n  Role: ${chalk.cyan(roleId)}\n`));
  console.log(`  Title:      ${r.title}`);
  console.log(`  Mandate:    ${r.mandate}`);
  console.log(`  Authority:  ${authority}`);
  console.log(`  Runtime:    ${chalk.dim(r.runtime)}`);
  console.log('');
}
