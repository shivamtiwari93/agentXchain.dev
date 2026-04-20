import { execFileSync } from 'node:child_process';
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import { loadProjectContext } from './config.js';
import { writeDispatchBundle } from './dispatch-bundle.js';
import { getActiveTurn, initializeGovernedRun, assignGovernedTurn, readTurnCostUsd } from './governed-state.js';
import { dispatchApiProxy } from './adapters/api-proxy-adapter.js';
import { dispatchLocalCli, saveDispatchLogs } from './adapters/local-cli-adapter.js';
import { dispatchMcp } from './adapters/mcp-adapter.js';
import { dispatchRemoteAgent } from './adapters/remote-agent-adapter.js';
import { getDispatchPromptPath, getTurnStagingResultPath } from './turn-paths.js';
import { validateStagedTurnResult } from './turn-result-validator.js';
import { probeRuntimeSpawnContext } from './runtime-spawn-context.js';
import { buildConnectorSchemaContract } from './connector-schema-contract.js';
import { getClaudeSubprocessAuthIssue } from './claude-local-auth.js';

const VALIDATABLE_RUNTIME_TYPES = new Set(['local_cli', 'api_proxy', 'mcp', 'remote_agent']);
const DEFAULT_VALIDATE_TIMEOUT_MS = 120_000;

export async function validateConfiguredConnector(sourceRoot, options = {}) {
  const sourceContext = loadProjectContext(sourceRoot);
  if (!sourceContext) {
    return {
      ok: false,
      exitCode: 2,
      overall: 'error',
      error: 'No governed agentxchain.json found.',
    };
  }

  if (sourceContext.config.protocol_mode !== 'governed') {
    return {
      ok: false,
      exitCode: 2,
      overall: 'error',
      error: 'connector validate only supports governed projects.',
    };
  }

  const runtimeId = typeof options.runtimeId === 'string' ? options.runtimeId.trim() : '';
  if (!runtimeId) {
    return {
      ok: false,
      exitCode: 2,
      overall: 'error',
      error: 'Runtime id is required. Usage: agentxchain connector validate <runtime_id>',
    };
  }

  const timeoutMs = Number.parseInt(options.timeoutMs ?? DEFAULT_VALIDATE_TIMEOUT_MS, 10);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return {
      ok: false,
      exitCode: 2,
      overall: 'error',
      error: 'Timeout must be a positive integer.',
    };
  }

  const runtime = sourceContext.config.runtimes?.[runtimeId];
  if (!runtime) {
    return {
      ok: false,
      exitCode: 2,
      overall: 'error',
      error: `Unknown connector runtime "${runtimeId}"`,
    };
  }
  if (runtime.type === 'manual') {
    return {
      ok: false,
      exitCode: 2,
      overall: 'error',
      error: `Runtime "${runtimeId}" is manual. connector validate only supports automated runtimes.`,
    };
  }
  if (!VALIDATABLE_RUNTIME_TYPES.has(runtime.type)) {
    return {
      ok: false,
      exitCode: 2,
      overall: 'error',
      error: `Runtime "${runtimeId}" of type "${runtime.type}" cannot be validated by connector validate.`,
    };
  }

  const roleSelection = resolveValidationRole(sourceContext.config, runtimeId, options.roleId);
  if (!roleSelection.ok) {
    return {
      ok: false,
      exitCode: 2,
      overall: 'error',
      error: roleSelection.error,
    };
  }

  // DEC-BUG54-CLAUDE-AUTH-PREFLIGHT-001 — refuse the known-hanging Claude
  // local_cli shape before burning the scratch-workspace + synthetic-dispatch
  // ceremony. The adapter also refuses this shape via `claude_auth_preflight_failed`,
  // but the operator gets a faster, identical-fix message if we catch it here.
  const claudeAuthIssue = getClaudeSubprocessAuthIssue(runtime);
  if (claudeAuthIssue) {
    return {
      ok: false,
      exitCode: 1,
      overall: 'fail',
      runtime_id: runtimeId,
      runtime_type: runtime.type,
      role_id: roleSelection.roleId,
      timeout_ms: timeoutMs,
      warnings: [
        ...roleSelection.warnings,
        {
          probe_kind: 'auth_preflight',
          level: 'fail',
          detail: claudeAuthIssue.detail,
          fix: claudeAuthIssue.fix,
        },
      ],
      error_code: 'claude_auth_preflight_failed',
      error: claudeAuthIssue.detail,
      auth_env_present: claudeAuthIssue.auth_env_present,
      fix: claudeAuthIssue.fix,
      dispatch: null,
      validation: null,
      scratch_root: null,
    };
  }

  const tempBase = mkdtempSync(join(tmpdir(), 'axc-connector-validate-'));
  const scratchRoot = join(tempBase, 'workspace');
  const warnings = [...roleSelection.warnings];
  const schemaContract = buildConnectorSchemaContract(
    sourceContext.rawConfig,
    sourceContext.config,
    runtimeId,
    roleSelection.roleId
  );

  // Surface capability declaration warnings for self-declared connectors
  const { getCapabilityDeclarationWarnings } = await import('./runtime-capabilities.js');
  const capWarnings = getCapabilityDeclarationWarnings(runtime);
  warnings.push(...capWarnings);

  let keepArtifacts = options.keepArtifacts === true;
  let dispatch = null;
  let validation = null;
  let costUsd = null;

  try {
    if (!schemaContract.ok) {
      return {
        ok: false,
        exitCode: 1,
        overall: 'fail',
        runtime_id: runtimeId,
        runtime_type: runtime.type,
        role_id: roleSelection.roleId,
        timeout_ms: timeoutMs,
        warnings,
        schema_contract: schemaContract,
        dispatch: null,
        validation: null,
        error: 'Schema contract continuity failed before synthetic dispatch.',
        scratch_root: null,
      };
    }

    copyRepoForValidation(sourceRoot, scratchRoot);
    initializeScratchGit(scratchRoot);

    const scratchContext = loadProjectContext(scratchRoot);
    if (!scratchContext) {
      return {
        ok: false,
        exitCode: 1,
        overall: 'fail',
        runtime_id: runtimeId,
        runtime_type: runtime.type,
        role_id: roleSelection.roleId,
        timeout_ms: timeoutMs,
        warnings,
        schema_contract: schemaContract,
        error: 'Failed to load governed config inside scratch workspace.',
        scratch_root: scratchRoot,
      };
    }

    if (runtime.type === 'local_cli' || (runtime.type === 'mcp' && (runtime.transport || 'stdio') !== 'streamable_http')) {
      const spawnProbe = probeRuntimeSpawnContext(scratchRoot, scratchContext.config.runtimes[runtimeId], { runtimeId });
      if (!spawnProbe.ok) {
        return {
          ok: false,
          exitCode: 1,
          overall: 'fail',
          runtime_id: runtimeId,
          runtime_type: runtime.type,
          role_id: roleSelection.roleId,
          timeout_ms: timeoutMs,
          warnings,
          schema_contract: schemaContract,
          dispatch: null,
          validation: null,
          error: spawnProbe.detail,
          scratch_root: scratchRoot,
        };
      }
    }

    const initResult = initializeGovernedRun(scratchRoot, scratchContext.config, {
      provenance: {
        trigger: 'connector_validate',
        runtime_id: runtimeId,
        role_id: roleSelection.roleId,
      },
    });
    if (!initResult.ok) {
      return {
        ok: false,
        exitCode: 1,
        overall: 'fail',
        runtime_id: runtimeId,
        runtime_type: runtime.type,
        role_id: roleSelection.roleId,
        timeout_ms: timeoutMs,
        warnings,
        schema_contract: schemaContract,
        error: initResult.error,
        scratch_root: scratchRoot,
      };
    }

    const assignResult = assignGovernedTurn(scratchRoot, scratchContext.config, roleSelection.roleId);
    if (!assignResult.ok) {
      return {
        ok: false,
        exitCode: 1,
        overall: 'fail',
        runtime_id: runtimeId,
        runtime_type: runtime.type,
        role_id: roleSelection.roleId,
        timeout_ms: timeoutMs,
        warnings,
        schema_contract: schemaContract,
        error: assignResult.error,
        scratch_root: scratchRoot,
      };
    }

    const state = assignResult.state;
    const turn = getActiveTurn(state);
    if (!turn) {
      return {
        ok: false,
        exitCode: 1,
        overall: 'fail',
        runtime_id: runtimeId,
        runtime_type: runtime.type,
        role_id: roleSelection.roleId,
        timeout_ms: timeoutMs,
        warnings,
        schema_contract: schemaContract,
        error: 'Synthetic validation turn was not assigned.',
        scratch_root: scratchRoot,
      };
    }

    const bundleResult = writeDispatchBundle(scratchRoot, state, scratchContext.config, { turnId: turn.turn_id });
    if (!bundleResult.ok) {
      return {
        ok: false,
        exitCode: 1,
        overall: 'fail',
        runtime_id: runtimeId,
        runtime_type: runtime.type,
        role_id: roleSelection.roleId,
        timeout_ms: timeoutMs,
        warnings,
        schema_contract: schemaContract,
        error: bundleResult.error,
        scratch_root: scratchRoot,
      };
    }
    if (Array.isArray(bundleResult.warnings)) {
      warnings.push(...bundleResult.warnings);
    }

    appendValidationPrompt(scratchRoot, scratchContext.config, state, turn);
    configureRuntimeValidationTimeout(scratchContext.config, runtimeId, timeoutMs);

    const signal = AbortSignal.timeout(timeoutMs);
    const adapterResult = await dispatchValidationTurn(
      scratchRoot,
      state,
      scratchContext.config,
      runtimeId,
      { turnId: turn.turn_id, signal },
    );

    dispatch = {
      ok: adapterResult.ok,
      error: adapterResult.error || null,
      timed_out: adapterResult.timedOut === true,
      aborted: adapterResult.aborted === true,
      log_count: Array.isArray(adapterResult.logs) ? adapterResult.logs.length : 0,
    };

    if (Array.isArray(adapterResult.logs) && adapterResult.logs.length > 0) {
      saveDispatchLogs(scratchRoot, turn.turn_id, adapterResult.logs);
    }

    if (!adapterResult.ok) {
      keepArtifacts = true;
      return {
        ok: false,
        exitCode: 1,
        overall: 'fail',
        runtime_id: runtimeId,
        runtime_type: runtime.type,
        role_id: roleSelection.roleId,
        timeout_ms: timeoutMs,
        warnings,
        schema_contract: schemaContract,
        dispatch,
        validation: null,
        scratch_root: scratchRoot,
      };
    }

    validation = validateStagedTurnResult(scratchRoot, state, scratchContext.config, {
      stagingPath: getTurnStagingResultPath(turn.turn_id),
    });
    costUsd = validation?.turnResult ? readTurnCostUsd(validation.turnResult) : null;

    if (!validation.ok) {
      keepArtifacts = true;
      return {
        ok: false,
        exitCode: 1,
        overall: 'fail',
        runtime_id: runtimeId,
        runtime_type: runtime.type,
        role_id: roleSelection.roleId,
        timeout_ms: timeoutMs,
        warnings,
        schema_contract: schemaContract,
        dispatch,
        validation: {
          ok: false,
          stage: validation.stage,
          error_class: validation.error_class,
          errors: validation.errors,
          warnings: validation.warnings,
        },
        cost_usd: costUsd,
        scratch_root: scratchRoot,
      };
    }

    return {
      ok: true,
      exitCode: 0,
      overall: 'pass',
      runtime_id: runtimeId,
      runtime_type: runtime.type,
      role_id: roleSelection.roleId,
      timeout_ms: timeoutMs,
      warnings,
      schema_contract: schemaContract,
      dispatch,
      validation: {
        ok: true,
        stage: null,
        error_class: null,
        errors: [],
        warnings: validation.warnings,
      },
      cost_usd: costUsd,
      scratch_root: keepArtifacts ? scratchRoot : null,
    };
  } catch (error) {
    keepArtifacts = true;
    return {
      ok: false,
      exitCode: 1,
      overall: 'fail',
      runtime_id: runtimeId,
      runtime_type: runtime.type,
      role_id: roleSelection.roleId,
      timeout_ms: timeoutMs,
      warnings,
      schema_contract: schemaContract,
      dispatch,
      validation,
      error: error.message,
      scratch_root: scratchRoot,
    };
  } finally {
    if (!keepArtifacts) {
      try {
        rmSync(tempBase, { recursive: true, force: true });
      } catch {}
    }
  }
}

function resolveValidationRole(config, runtimeId, requestedRoleId) {
  const matchingRoles = Object.entries(config.roles || {})
    .filter(([, role]) => (role.runtime_id || role.runtime) === runtimeId)
    .map(([roleId]) => roleId)
    .sort((a, b) => a.localeCompare(b, 'en'));

  if (matchingRoles.length === 0) {
    return { ok: false, error: `No roles are bound to runtime "${runtimeId}".` };
  }

  if (requestedRoleId) {
    if (!config.roles?.[requestedRoleId]) {
      return { ok: false, error: `Unknown role "${requestedRoleId}".` };
    }
    const boundRuntimeId = config.roles[requestedRoleId].runtime_id || config.roles[requestedRoleId].runtime;
    if (boundRuntimeId !== runtimeId) {
      return {
        ok: false,
        error: `Role "${requestedRoleId}" is not bound to runtime "${runtimeId}".`,
      };
    }
    return { ok: true, roleId: requestedRoleId, warnings: [] };
  }

  const warnings = [];
  if (matchingRoles.length > 1) {
    warnings.push(
      `Runtime "${runtimeId}" is shared by multiple roles (${matchingRoles.join(', ')}). ` +
      `Validated the first binding "${matchingRoles[0]}". Use --role to target another binding.`,
    );
  }

  return {
    ok: true,
    roleId: matchingRoles[0],
    warnings,
  };
}

function copyRepoForValidation(sourceRoot, scratchRoot) {
  mkdirSync(scratchRoot, { recursive: true });
  copyTree(sourceRoot, scratchRoot);
}

function copyTree(sourcePath, destPath) {
  mkdirSync(destPath, { recursive: true });
  for (const entry of readdirSync(sourcePath, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === '.agentxchain') {
      continue;
    }

    const sourceEntry = join(sourcePath, entry.name);
    const destEntry = join(destPath, entry.name);
    const stats = lstatSync(sourceEntry);

    if (stats.isSymbolicLink()) {
      symlinkSync(readlinkSync(sourceEntry), destEntry);
      continue;
    }

    if (stats.isDirectory()) {
      if (entry.name === 'node_modules') {
        symlinkSync(sourceEntry, destEntry, 'dir');
        continue;
      }
      copyTree(sourceEntry, destEntry);
      continue;
    }

    mkdirSync(dirname(destEntry), { recursive: true });
    cpSync(sourceEntry, destEntry, { force: true, preserveTimestamps: true });
  }
}

function initializeScratchGit(root) {
  execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['checkout', '-q', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['commit', '-q', '-m', 'connector validation baseline'], {
    cwd: root,
    stdio: 'ignore',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'AgentXchain Validator',
      GIT_AUTHOR_EMAIL: 'noreply@agentxchain.dev',
      GIT_COMMITTER_NAME: 'AgentXchain Validator',
      GIT_COMMITTER_EMAIL: 'noreply@agentxchain.dev',
    },
  });
}

function appendValidationPrompt(root, config, state, turn) {
  const promptPath = join(root, getDispatchPromptPath(turn.turn_id));
  const role = config.roles?.[turn.assigned_role];
  const reviewOnly = role?.write_authority === 'review_only';
  const validationTurn = {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'Connector validation synthetic turn completed without modifying product files.',
    decisions: [
      {
        id: 'DEC-900',
        category: 'process',
        statement: 'The runtime emitted a schema-valid connector validation result.',
        rationale: 'Synthetic dispatch completed and staged a governed turn result.',
      },
    ],
    objections: reviewOnly ? [
      {
        id: 'OBJ-900',
        severity: 'low',
        statement: 'Validation objection: this is a synthetic proof turn, not delivery work.',
        status: 'acknowledged',
      },
    ] : [],
    files_changed: [],
    verification: {
      status: 'skipped',
      evidence_summary: 'Synthetic connector validation turn; no repo work requested.',
    },
    artifact: {
      type: 'review',
      ref: null,
    },
    proposed_next_role: 'human',
  };

  const lines = [
    '',
    '## Connector Validation Override',
    '',
    'This dispatch is a connector-validation proof turn, not real product work.',
    '',
    'You must follow these extra constraints:',
    '',
    '1. Do not edit any product files.',
    '2. Write exactly one governed turn result to the staged result path already provided in ASSIGNMENT.json.',
    '3. Use `files_changed: []` and `artifact.type: "review"`.',
    '4. Do not request a phase transition or run completion.',
    '5. Set `proposed_next_role: "human"`.',
    reviewOnly ? '6. Include at least one objection because this role is review_only.' : '6. Objections may be empty because this role is not review_only.',
    '',
    'Use this JSON shape as your starting point and replace nothing except if you need equivalent wording:',
    '',
    '```json',
    JSON.stringify(validationTurn, null, 2),
    '```',
    '',
  ];

  writeFileSync(promptPath, lines.join('\n'), { flag: 'a' });
}

function configureRuntimeValidationTimeout(config, runtimeId, timeoutMs) {
  if (config?.runtimes?.[runtimeId] && config.runtimes[runtimeId].type === 'remote_agent') {
    config.runtimes[runtimeId] = {
      ...config.runtimes[runtimeId],
      timeout_ms: timeoutMs,
    };
  }
}

async function dispatchValidationTurn(root, state, config, runtimeId, options = {}) {
  const runtime = config.runtimes?.[runtimeId];
  switch (runtime?.type) {
    case 'local_cli':
      return dispatchLocalCli(root, state, config, options);
    case 'api_proxy':
      return dispatchApiProxy(root, state, config, options);
    case 'mcp':
      return dispatchMcp(root, state, config, options);
    case 'remote_agent':
      return dispatchRemoteAgent(root, state, config, options);
    default:
      return { ok: false, error: `Unsupported runtime type "${runtime?.type || 'unknown'}"` };
  }
}

export { DEFAULT_VALIDATE_TIMEOUT_MS, VALIDATABLE_RUNTIME_TYPES };
