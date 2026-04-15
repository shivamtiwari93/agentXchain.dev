import chalk from 'chalk';
import { loadProjectContext } from '../lib/config.js';
import {
  getRoleRuntimeCapabilityContract,
  summarizeRuntimeCapabilityContract,
} from '../lib/runtime-capabilities.js';

export function roleCommand(subcommand, roleId, opts) {
  const context = loadProjectContext();
  if (!context) {
    console.log(chalk.red('  No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { config, version } = context;

  if (version !== 4) {
    console.log(chalk.red('  Not a governed AgentXchain project (requires v4 config).'));
    process.exit(1);
  }

  const roles = config.roles || {};
  const runtimes = config.runtimes || {};
  const roleIds = Object.keys(roles);

  if (subcommand === 'show') {
    return showRole(roleId, roles, runtimes, roleIds, opts);
  }

  // Default: list
  return listRoles(roles, runtimes, roleIds, opts);
}

function listRoles(roles, runtimes, roleIds, opts) {
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
      const runtimeId = roles[id].runtime_id;
      const runtime = runtimes[runtimeId];
      const entry = {
        id,
        title: roles[id].title,
        mandate: roles[id].mandate,
        write_authority: roles[id].write_authority,
        runtime: runtimeId,
        runtime_contract: runtime ? getRoleRuntimeCapabilityContract(id, roles[id], runtime).runtime_contract : null,
      };
      if (typeof roles[id]?.decision_authority === 'number') {
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
    const runtime = runtimes[r.runtime_id];
    const contract = runtime ? getRoleRuntimeCapabilityContract(id, r, runtime) : null;
    const authority = r.write_authority === 'authoritative'
      ? chalk.green(r.write_authority)
      : r.write_authority === 'proposed'
        ? chalk.yellow(r.write_authority)
        : chalk.dim(r.write_authority);
    const decAuth = typeof r?.decision_authority === 'number' ? chalk.dim(` dec:${r.decision_authority}`) : '';
    const capabilitySuffix = contract ? chalk.dim(` {${summarizeRuntimeCapabilityContract(contract.runtime_contract)}}`) : '';
    console.log(`  ${chalk.cyan(id)} — ${r.title} [${authority}${decAuth}] → ${chalk.dim(r.runtime_id)}${capabilitySuffix}`);
  }
  console.log('');
  console.log(chalk.dim('  Usage: agentxchain role show <role_id>\n'));
}

function showRole(roleId, roles, runtimes, roleIds, opts) {
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
  const runtime = runtimes[r.runtime_id];
  const capability = runtime ? getRoleRuntimeCapabilityContract(roleId, r, runtime) : null;

  if (opts.json) {
    const entry = {
      id: roleId,
      title: r.title,
      mandate: r.mandate,
      write_authority: r.write_authority,
      runtime: r.runtime_id,
      runtime_contract: capability?.runtime_contract || null,
      effective_runtime_contract: capability
        ? {
            role_id: capability.role_id,
            role_write_authority: capability.role_write_authority,
            effective_write_path: capability.effective_write_path,
            workflow_artifact_ownership: capability.workflow_artifact_ownership,
            notes: capability.notes,
          }
        : null,
    };
    if (typeof r?.decision_authority === 'number') {
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
  if (typeof r?.decision_authority === 'number') {
    console.log(`  Decision:   ${r.decision_authority}`);
  }
  console.log(`  Runtime:    ${chalk.dim(r.runtime_id)}`);
  if (capability) {
    const base = capability.runtime_contract;
    console.log(`  Transport:  ${base.transport}`);
    console.log(`  Writes:     ${base.can_write_files}`);
    console.log(`  Review:     ${base.review_only_behavior}`);
    console.log(`  Proposals:  ${base.proposal_support}`);
    console.log(`  Binary:     ${base.requires_local_binary ? 'yes' : 'no'}`);
    console.log(`  owned_by:   ${base.workflow_artifact_ownership}`);
    console.log(`  Effective:  ${capability.effective_write_path}`);
    console.log(`  Ownership:  ${capability.workflow_artifact_ownership}`);
    for (const note of capability.notes) {
      console.log(`  Note:       ${note}`);
    }
  }
  console.log('');
}
