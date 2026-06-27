import chalk from 'chalk';
import { loadProjectContext } from '../lib/config.js';
import {
  getRoleRuntimeCapabilityContract,
  summarizeRuntimeCapabilityContract,
} from '../lib/runtime-capabilities.js';
import {
  evaluateRoleCharter,
  evaluateAllRoleCharters,
} from '../lib/role-charter.js';

export function roleCommand(subcommand, roleId, opts) {
  const context = loadProjectContext();
  if (!context) {
    console.log(chalk.red('  No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { config, rawConfig, version } = context;

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

  if (subcommand === 'validate') {
    return validateRoles(roleId, config, rawConfig, roleIds, opts);
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

function renderCharterReport(report) {
  const mark = report.overall === 'well_formed' ? chalk.green('✓') : chalk.red('✗');
  if (report.overall === 'well_formed') {
    console.log(`  ${mark} ${chalk.cyan(report.role_id)} well-formed (4/4 invariants)`);
    return;
  }
  console.log(`  ${mark} ${chalk.cyan(report.role_id)} incomplete — missing: ${report.missing.join(', ')}`);
  for (const inv of report.invariants) {
    if (!inv.satisfied && inv.fix_hint) {
      console.log(chalk.dim(`      → ${inv.fix_hint}`));
    }
  }
}

function validateRoles(roleId, config, rawConfig, roleIds, opts) {
  // Single-role validation
  if (roleId) {
    if (!config.roles?.[roleId]) {
      console.log(chalk.red(`  Unknown role: ${roleId}`));
      console.log(chalk.dim(`  Available: ${roleIds.join(', ')}`));
      process.exit(1);
    }
    const report = evaluateRoleCharter(config, rawConfig, roleId);
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log('');
      renderCharterReport(report);
      console.log('');
    }
    process.exit(report.overall === 'well_formed' ? 0 : 1);
  }

  // All-roles validation
  const all = evaluateAllRoleCharters(config, rawConfig);
  if (opts.json) {
    console.log(JSON.stringify(all, null, 2));
    process.exit(all.incomplete === 0 ? 0 : 1);
  }

  if (all.total === 0) {
    console.log('  No roles defined.');
    process.exit(0);
  }

  if (all.incomplete === 0) {
    console.log(chalk.bold(`\n  Role charter validation (${all.total} roles): all well-formed (4/4 invariants each).\n`));
    process.exit(0);
  }

  console.log(chalk.bold(`\n  Role charter validation (${all.total} roles):\n`));
  for (const report of all.roles) {
    renderCharterReport(report);
  }
  console.log('');
  console.log(`  ${all.incomplete} of ${all.total} roles incomplete.`);
  console.log('');
  process.exit(1);
}
