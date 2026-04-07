/**
 * Migrate a legacy v3 AgentXchain project to governed mode.
 *
 * Non-destructive: backs up the original config, archives legacy coordination
 * artifacts, and creates governed state + directory structure.
 *
 * Frozen rules (§32 + §38):
 *   - Legacy projects are supported, not upgraded silently.
 *   - No automatic rewrite on read.
 *   - Legacy history is archived, not backfilled into governed history.
 *   - Post-migration state is `paused`, not `active`.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, copyFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { findProjectRoot, CONFIG_FILE } from '../lib/config.js';
import { loadNormalizedConfig, detectConfigVersion } from '../lib/normalized-config.js';

const LEGACY_ARTIFACTS = ['lock.json', 'state.json', 'state.md', 'history.jsonl', 'log.md'];

function inferPhase(legacyState) {
  if (!legacyState) return 'planning';
  const phase = String(legacyState.phase || '').toLowerCase();
  if (phase.includes('build') || phase.includes('implement')) return 'implementation';
  if (phase.includes('qa') || phase.includes('test')) return 'qa';
  return 'planning';
}

export async function migrateCommand(opts) {
  const root = findProjectRoot();
  if (!root) {
    console.error(chalk.red('  No agentxchain.json found. Run this from inside a project.'));
    process.exit(1);
  }

  // Read raw config
  let rawConfig;
  try {
    rawConfig = JSON.parse(readFileSync(join(root, CONFIG_FILE), 'utf8'));
  } catch (err) {
    console.error(chalk.red(`  Could not read agentxchain.json: ${err.message}`));
    process.exit(1);
  }

  const version = detectConfigVersion(rawConfig);
  if (version === 4) {
    console.log(chalk.yellow('  This project is already governed. Nothing to migrate.'));
    return;
  }
  if (version !== 3) {
    console.error(chalk.red('  Unrecognized config format. Only v3 projects can be migrated.'));
    process.exit(1);
  }

  // Normalize to understand the current shape
  const normalized = loadNormalizedConfig(rawConfig);
  if (!normalized.ok) {
    console.error(chalk.red(`  Config validation failed: ${normalized.errors.join(', ')}`));
    process.exit(1);
  }

  // Confirmation
  if (!opts.yes) {
    console.log('');
    console.log(chalk.cyan('  Migration preview:'));
    console.log(`    Project: ${rawConfig.project}`);
    console.log(`    Agents:  ${Object.keys(rawConfig.agents || {}).join(', ')}`);
    console.log('');
    console.log(chalk.dim('  This will:'));
    console.log(chalk.dim('    1. Back up agentxchain.json'));
    console.log(chalk.dim('    2. Rewrite config to governed mode'));
    console.log(chalk.dim('    3. Create .agentxchain/ directory structure'));
    console.log(chalk.dim('    4. Archive legacy coordination files'));
    console.log(chalk.dim('    5. Set status to paused (requires human review)'));
    console.log('');

    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: 'Proceed with migration?',
      default: true
    }]);
    if (!confirm) {
      console.log(chalk.yellow('  Aborted.'));
      return;
    }
  }

  // Create directories
  mkdirSync(join(root, '.agentxchain', 'backups'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'legacy'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'prompts'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'reviews'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'dispatch'), { recursive: true });

  // Step 1: Backup
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(root, '.agentxchain', 'backups', `agentxchain.v3.${timestamp}.json`);
  copyFileSync(join(root, CONFIG_FILE), backupPath);

  // Step 2: Build governed config from legacy
  const norm = normalized.normalized;
  const projectId = norm.project.id;
  const projectName = norm.project.name;

  const roles = {};
  const runtimes = {};
  const inferences = [];

  for (const [id, role] of Object.entries(norm.roles)) {
    const runtimeId = `manual-${id}`;
    roles[id] = {
      title: role.title,
      mandate: role.mandate,
      write_authority: role.write_authority,
      runtime: runtimeId
    };
    runtimes[runtimeId] = { type: 'manual' };
    inferences.push({
      role: id,
      field: 'write_authority',
      inferred: role.write_authority,
      note: 'Inferred from role name heuristic. Review and adjust if incorrect.'
    });
    inferences.push({
      role: id,
      field: 'runtime',
      inferred: 'manual',
      note: 'All legacy agents default to manual runtime. Change to local_cli or api_proxy as needed.'
    });
  }

  const roleIds = Object.keys(roles);
  const routing = {
    planning: {
      entry_role: roleIds[0] || 'pm',
      allowed_next_roles: [...roleIds, 'human'],
      exit_gate: 'planning_signoff'
    },
    implementation: {
      entry_role: roleIds.find(r => r.includes('dev')) || roleIds[0],
      allowed_next_roles: [...roleIds, 'human'],
      exit_gate: 'implementation_complete'
    },
    qa: {
      entry_role: roleIds.find(r => r.includes('qa')) || roleIds[0],
      allowed_next_roles: [...roleIds, 'human'],
      exit_gate: 'qa_ship_verdict'
    }
  };

  const governedConfig = {
    schema_version: '1.0',
    template: 'generic',
    project: {
      id: projectId,
      name: projectName,
      default_branch: norm.project.default_branch
    },
    roles,
    runtimes,
    routing,
    gates: {
      planning_signoff: {
        requires_files: ['.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md', '.planning/SYSTEM_SPEC.md'],
        requires_human_approval: true
      },
      implementation_complete: {
        requires_files: ['.planning/IMPLEMENTATION_NOTES.md'],
        requires_verification_pass: true
      },
      qa_ship_verdict: {
        requires_files: ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md', '.planning/RELEASE_NOTES.md'],
        requires_human_approval: true
      }
    },
    budget: {
      per_turn_max_usd: 2.0,
      per_run_max_usd: 50.0,
      on_exceed: 'pause_and_escalate'
    },
    retention: {
      talk_strategy: 'append_only',
      history_strategy: 'jsonl_append_only'
    },
    prompts: Object.fromEntries(roleIds.map(id => [id, `.agentxchain/prompts/${id}.md`])),
    rules: {
      challenge_required: norm.rules.challenge_required,
      max_turn_retries: 2,
      max_deadlock_cycles: 2
    }
  };

  // Step 3: Read legacy state for phase inference
  let legacyState = null;
  const legacyStatePath = join(root, 'state.json');
  if (existsSync(legacyStatePath)) {
    try { legacyState = JSON.parse(readFileSync(legacyStatePath, 'utf8')); } catch {}
  }

  const inferredPhase = inferPhase(legacyState);

  const governedState = {
    schema_version: '1.1',
    run_id: null,
    project_id: projectId,
    status: 'paused',
    phase: inferredPhase,
    accepted_integration_ref: null,
    active_turns: {},
    turn_sequence: 0,
    last_completed_turn_id: null,
    blocked_on: 'human:migration-review',
    blocked_reason: null,
    escalation: null,
    queued_phase_transition: null,
    queued_run_completion: null,
    phase_gate_status: {
      planning_signoff: inferredPhase === 'planning' ? 'pending' : 'passed',
      implementation_complete: inferredPhase === 'qa' ? 'passed' : 'pending',
      qa_ship_verdict: 'pending'
    },
    budget_reservations: {},
    budget_status: {
      spent_usd: 0,
      remaining_usd: governedConfig.budget.per_run_max_usd
    }
  };

  // Step 4: Write governed config and state
  writeFileSync(join(root, CONFIG_FILE), JSON.stringify(governedConfig, null, 2) + '\n');
  writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify(governedState, null, 2) + '\n');
  writeFileSync(join(root, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), '');

  // Step 5: Generate prompt templates
  for (const [id, role] of Object.entries(roles)) {
    const promptContent = `# ${role.title}\n\n## Identity\n\nYou are the **${role.title}** on this project.\n\n**Mandate:** ${role.mandate}\n\n**Write authority:** ${role.write_authority}\n**Runtime:** ${role.runtime}\n\n## Protocol Rules\n\n1. Challenge the previous turn explicitly.\n2. Do not claim verification you did not perform.\n3. Do not modify reserved state files under \`.agentxchain/\`.\n4. Emit structured turn result to \`.agentxchain/staging/<turn_id>/turn-result.json\`.\n5. Propose next role, but do not assume routing authority.\n`;
    writeFileSync(join(root, '.agentxchain', 'prompts', `${id}.md`), promptContent);
  }

  // Step 6: Archive legacy artifacts
  const archived = [];
  for (const file of LEGACY_ARTIFACTS) {
    const src = join(root, file);
    if (existsSync(src)) {
      const dest = join(root, '.agentxchain', 'legacy', file);
      copyFileSync(src, dest);
      archived.push(file);
    }
  }

  // Step 7: Write migration report
  const report = {
    migrated_at: new Date().toISOString(),
    original_version: 3,
    target_version: '1.0',
    project: projectName,
    template: 'generic',
    backup_path: `.agentxchain/backups/agentxchain.v3.${timestamp}.json`,
    inferred_phase: inferredPhase,
    archived_files: archived,
    inferences,
    post_migration_status: 'paused',
    post_migration_blocked_on: 'human:migration-review',
    requires_human_review: [
      'Verify write_authority for each role',
      'Update runtimes from manual to local_cli or api_proxy as needed',
      'Review inferred phase and gate status',
      'Review and customize prompt templates in .agentxchain/prompts/',
      'Review the migration state, then start the first governed turn with agentxchain resume'
    ]
  };

  const reportMd = `# Migration Report

**Migrated at:** ${report.migrated_at}
**Original version:** v3 → governed mode (schema_version: "1.0")
**Project:** ${projectName}
**Template:** \`generic\` (explicit baseline; migrate does not infer project shape)
**Backup:** \`${report.backup_path}\`

## Inferred Phase

**${inferredPhase}** (derived from legacy state)

## Archived Legacy Files

${archived.map(f => `- \`${f}\` → \`.agentxchain/legacy/${f}\``).join('\n') || '(none)'}

## Inferred Fields Requiring Review

${inferences.map(i => `- **${i.role}.${i.field}** = \`${i.inferred}\` — ${i.note}`).join('\n')}

## Post-Migration Status

**Status:** paused
**Blocked on:** human:migration-review

## Required Human Actions

${report.requires_human_review.map((r, i) => `${i + 1}. ${r}`).join('\n')}
`;

  writeFileSync(join(root, '.agentxchain', 'migration-report.md'), reportMd);

  // Ensure planning artifacts exist
  mkdirSync(join(root, '.planning'), { recursive: true });
  const planningFiles = {
    'PM_SIGNOFF.md': `# PM Signoff — ${projectName}\n\nApproved: NO\n`,
    'ROADMAP.md': `# Roadmap — ${projectName}\n\n(Migrated from v3. Review and update.)\n`,
    'SYSTEM_SPEC.md': `# System Spec — ${projectName}\n\n## Purpose\n\n(Describe the migrated subsystem purpose.)\n\n## Interface\n\n(List the commands, files, APIs, or contracts this repo owns.)\n\n## Behavior\n\n(Describe the expected runtime behavior.)\n\n## Error Cases\n\n(List the important failure modes.)\n\n## Acceptance Tests\n\n- [ ] Name the executable checks required before implementation resumes.\n\n## Open Questions\n\n- (Capture migration-specific gaps here.)\n`,
    'IMPLEMENTATION_NOTES.md': `# Implementation Notes — ${projectName}\n\n## Changes\n\n(Dev fills this during implementation)\n\n## Verification\n\n(Dev fills this during implementation)\n\n## Unresolved Follow-ups\n\n(Dev lists any known gaps, tech debt, or follow-up items here.)\n`,
    'acceptance-matrix.md': `# Acceptance Matrix — ${projectName}\n\n(QA fills this.)\n`,
    'ship-verdict.md': `# Ship Verdict — ${projectName}\n\n## Verdict: PENDING\n`,
    'RELEASE_NOTES.md': `# Release Notes — ${projectName}\n\n## User Impact\n\n(QA fills this during the QA phase)\n\n## Verification Summary\n\n(QA fills this during the QA phase)\n\n## Upgrade Notes\n\n(QA fills this during the QA phase)\n\n## Known Issues\n\n(QA fills this during the QA phase)\n`
  };
  for (const [file, content] of Object.entries(planningFiles)) {
    const path = join(root, '.planning', file);
    if (!existsSync(path)) {
      writeFileSync(path, content);
    }
  }

  // Output
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('');
  console.log(chalk.green(`  ✓ Migrated to governed mode`));
  console.log('');
  console.log(`    ${chalk.dim('Backup:')}   ${report.backup_path}`);
  console.log(`    ${chalk.dim('Archived:')} ${archived.join(', ') || '(none)'}`);
  console.log(`    ${chalk.dim('Phase:')}    ${inferredPhase}`);
  console.log(`    ${chalk.dim('Status:')}   paused (awaiting human review)`);
  console.log('');
  console.log(chalk.yellow('  ⚠  Review the migration report:'));
  console.log(`    ${chalk.bold('.agentxchain/migration-report.md')}`);
  console.log('');
  console.log(chalk.cyan('  Next:'));
  console.log(`    ${chalk.bold('agentxchain validate')} ${chalk.dim('# verify governed config')}`);
  console.log(`    ${chalk.bold('agentxchain status')} ${chalk.dim('# see governed state')}`);
  console.log(`    ${chalk.bold('agentxchain resume')} ${chalk.dim('# assign the first governed turn')}`);
  console.log(`    ${chalk.bold('agentxchain accept-turn')} ${chalk.dim('# accept a valid staged turn result')}`);
  console.log(`    ${chalk.bold('agentxchain reject-turn --reason "<reason>"')} ${chalk.dim('# retry or escalate a bad turn result')}`);
  console.log('');
}
