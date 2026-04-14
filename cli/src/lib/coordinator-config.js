import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadNormalizedConfig } from './normalized-config.js';
import { safeParseJson } from './schema.js';

export const COORDINATOR_CONFIG_FILE = 'agentxchain-multi.json';

const VALID_ID = /^[a-z0-9_-]+$/;
const DEFAULT_PHASES = new Set(['planning', 'implementation', 'qa']);
const VALID_PHASE_NAME = /^[a-z][a-z0-9_-]*$/;
const VALID_BARRIER_TYPES = new Set([
  'all_repos_accepted',
  'interface_alignment',
  'named_decisions',
  'ordered_repo_sequence',
  'shared_human_gate',
]);

function pushError(errors, code, message) {
  errors.push(`${code}: ${message}`);
}

function validateProject(raw, errors) {
  if (!raw.project || typeof raw.project !== 'object' || Array.isArray(raw.project)) {
    pushError(errors, 'project_invalid', 'project must be an object with id and name');
    return;
  }

  if (typeof raw.project.id !== 'string' || !raw.project.id.trim()) {
    pushError(errors, 'project_id_invalid', 'project.id must be a non-empty string');
  }

  if (typeof raw.project.name !== 'string' || !raw.project.name.trim()) {
    pushError(errors, 'project_name_invalid', 'project.name must be a non-empty string');
  }
}

function validateRepos(raw, errors) {
  if (!raw.repos || typeof raw.repos !== 'object' || Array.isArray(raw.repos) || Object.keys(raw.repos).length === 0) {
    pushError(errors, 'repos_invalid', 'repos must be a non-empty object');
    return [];
  }

  const repoIds = [];
  for (const [repoId, repo] of Object.entries(raw.repos)) {
    repoIds.push(repoId);

    if (!VALID_ID.test(repoId)) {
      pushError(errors, 'repo_id_invalid', `repo id "${repoId}" must be lowercase alphanumeric, hyphen, or underscore`);
    }

    if (!repo || typeof repo !== 'object' || Array.isArray(repo)) {
      pushError(errors, 'repo_invalid', `repo "${repoId}" must be an object`);
      continue;
    }

    if (typeof repo.path !== 'string' || !repo.path.trim()) {
      pushError(errors, 'repo_path_invalid', `repo "${repoId}" path must be a non-empty string`);
    }

    if ('default_branch' in repo && (typeof repo.default_branch !== 'string' || !repo.default_branch.trim())) {
      pushError(errors, 'repo_default_branch_invalid', `repo "${repoId}" default_branch must be a non-empty string when provided`);
    }

    if ('required' in repo && typeof repo.required !== 'boolean') {
      pushError(errors, 'repo_required_invalid', `repo "${repoId}" required must be a boolean when provided`);
    }
  }

  return repoIds;
}

function validateWorkstreams(raw, repoIds, errors) {
  if (!raw.workstreams || typeof raw.workstreams !== 'object' || Array.isArray(raw.workstreams) || Object.keys(raw.workstreams).length === 0) {
    pushError(errors, 'workstreams_invalid', 'workstreams must be a non-empty object');
    return [];
  }

  const repoIdSet = new Set(repoIds);
  const workstreamIds = Object.keys(raw.workstreams);
  const workstreamIdSet = new Set(workstreamIds);

  for (const [workstreamId, workstream] of Object.entries(raw.workstreams)) {
    if (!VALID_ID.test(workstreamId)) {
      pushError(errors, 'workstream_id_invalid', `workstream id "${workstreamId}" must be lowercase alphanumeric, hyphen, or underscore`);
    }

    if (!workstream || typeof workstream !== 'object' || Array.isArray(workstream)) {
      pushError(errors, 'workstream_invalid', `workstream "${workstreamId}" must be an object`);
      continue;
    }

    // Derive valid phases from routing keys when present; fall back to defaults
    const validPhases = raw.routing ? new Set(Object.keys(raw.routing)) : DEFAULT_PHASES;
    if (!validPhases.has(workstream.phase)) {
      const phaseList = [...validPhases].join(', ');
      pushError(
        errors,
        'workstream_phase_invalid',
        `workstream "${workstreamId}" phase must be one of: ${phaseList}`,
      );
    }

    if (!Array.isArray(workstream.repos) || workstream.repos.length === 0) {
      pushError(errors, 'workstream_repos_invalid', `workstream "${workstreamId}" repos must be a non-empty array`);
    } else {
      const seenRepos = new Set();
      for (const repoId of workstream.repos) {
        if (typeof repoId !== 'string' || !repoId.trim()) {
          pushError(errors, 'workstream_repo_invalid', `workstream "${workstreamId}" repos entries must be non-empty strings`);
          continue;
        }

        if (seenRepos.has(repoId)) {
          pushError(errors, 'workstream_repo_duplicate', `workstream "${workstreamId}" contains duplicate repo "${repoId}"`);
          continue;
        }
        seenRepos.add(repoId);

        if (!repoIdSet.has(repoId)) {
          pushError(errors, 'workstream_repo_unknown', `workstream "${workstreamId}" references undeclared repo "${repoId}"`);
        }
      }
    }

    if (typeof workstream.entry_repo !== 'string' || !workstream.entry_repo.trim()) {
      pushError(errors, 'workstream_entry_repo_invalid', `workstream "${workstreamId}" entry_repo must be a non-empty string`);
    } else if (!Array.isArray(workstream.repos) || !workstream.repos.includes(workstream.entry_repo)) {
      pushError(errors, 'workstream_entry_repo_mismatch', `workstream "${workstreamId}" entry_repo must also appear in workstream.repos`);
    }

    if (!Array.isArray(workstream.depends_on)) {
      pushError(errors, 'workstream_depends_on_invalid', `workstream "${workstreamId}" depends_on must be an array`);
    } else {
      for (const dependencyId of workstream.depends_on) {
        if (typeof dependencyId !== 'string' || !dependencyId.trim()) {
          pushError(errors, 'workstream_dependency_invalid', `workstream "${workstreamId}" depends_on entries must be non-empty strings`);
          continue;
        }

        if (!workstreamIdSet.has(dependencyId)) {
          pushError(errors, 'workstream_dependency_unknown', `workstream "${workstreamId}" depends_on undeclared workstream "${dependencyId}"`);
        }
      }
    }

    if (!VALID_BARRIER_TYPES.has(workstream.completion_barrier)) {
      pushError(
        errors,
        'workstream_completion_barrier_invalid',
        `workstream "${workstreamId}" completion_barrier must be one of: ${Array.from(VALID_BARRIER_TYPES).join(', ')}`,
      );
    }

    validateDecisionRequirementBarrier(workstreamId, workstream, errors);
  }

  detectWorkstreamCycles(raw.workstreams, errors);
  return workstreamIds;
}

function validateDecisionIdsByRepo(workstreamId, workstream, errors, sectionName, errorPrefix) {
  const section = workstream[sectionName];
  if (!section || typeof section !== 'object' || Array.isArray(section)) {
    pushError(
      errors,
      `${errorPrefix}_invalid`,
      `workstream "${workstreamId}" with completion_barrier "${workstream.completion_barrier}" must declare ${sectionName}.decision_ids_by_repo`,
    );
    return;
  }

  const byRepo = section.decision_ids_by_repo;
  if (!byRepo || typeof byRepo !== 'object' || Array.isArray(byRepo)) {
    pushError(
      errors,
      `${errorPrefix}_decisions_invalid`,
      `workstream "${workstreamId}" ${sectionName}.decision_ids_by_repo must be an object`,
    );
    return;
  }

  const repoIds = Array.isArray(workstream.repos) ? workstream.repos : [];
  const repoIdSet = new Set(repoIds);

  for (const repoId of repoIds) {
    if (!(repoId in byRepo)) {
      pushError(
        errors,
        `${errorPrefix}_repo_missing`,
        `workstream "${workstreamId}" must declare ${sectionName}.decision_ids_by_repo["${repoId}"]`,
      );
      continue;
    }

    const decisionIds = byRepo[repoId];
    if (!Array.isArray(decisionIds) || decisionIds.length === 0) {
      pushError(
        errors,
        `${errorPrefix}_repo_invalid`,
        `workstream "${workstreamId}" ${sectionName}.decision_ids_by_repo["${repoId}"] must be a non-empty array`,
      );
      continue;
    }

    const seen = new Set();
    for (const decisionId of decisionIds) {
      if (typeof decisionId !== 'string' || !/^DEC-\d+$/.test(decisionId)) {
        pushError(
          errors,
          `${errorPrefix}_decision_invalid`,
          `workstream "${workstreamId}" ${sectionName} decision "${decisionId}" for repo "${repoId}" must match DEC-NNN`,
        );
        continue;
      }
      if (seen.has(decisionId)) {
        pushError(
          errors,
          `${errorPrefix}_decision_duplicate`,
          `workstream "${workstreamId}" ${sectionName} decision "${decisionId}" is duplicated for repo "${repoId}"`,
        );
        continue;
      }
      seen.add(decisionId);
    }
  }

  for (const repoId of Object.keys(byRepo)) {
    if (!repoIdSet.has(repoId)) {
      pushError(
        errors,
        `${errorPrefix}_repo_unknown`,
        `workstream "${workstreamId}" ${sectionName} references undeclared repo "${repoId}"`,
      );
    }
  }
}

function validateDecisionRequirementBarrier(workstreamId, workstream, errors) {
  if (workstream.completion_barrier === 'interface_alignment') {
    validateDecisionIdsByRepo(
      workstreamId,
      workstream,
      errors,
      'interface_alignment',
      'workstream_interface_alignment',
    );
    return;
  }

  if (workstream.completion_barrier === 'named_decisions') {
    validateDecisionIdsByRepo(
      workstreamId,
      workstream,
      errors,
      'named_decisions',
      'workstream_named_decisions',
    );
  }
}

function normalizeDecisionIdsByRepo(section) {
  return section?.decision_ids_by_repo
    ? {
        decision_ids_by_repo: Object.fromEntries(
          Object.entries(section.decision_ids_by_repo).map(([repoId, decisionIds]) => [
            repoId,
            Array.isArray(decisionIds) ? [...new Set(decisionIds)] : [],
          ]),
        ),
      }
    : null;
}

function detectWorkstreamCycles(workstreams, errors) {
  const visiting = new Set();
  const visited = new Set();

  function visit(workstreamId, lineage) {
    if (visiting.has(workstreamId)) {
      const cycleStart = lineage.indexOf(workstreamId);
      const cyclePath = [...lineage.slice(cycleStart), workstreamId].join(' -> ');
      pushError(errors, 'workstream_cycle', `circular workstream dependency detected: ${cyclePath}`);
      return;
    }

    if (visited.has(workstreamId)) {
      return;
    }

    visiting.add(workstreamId);
    const dependencies = Array.isArray(workstreams[workstreamId]?.depends_on) ? workstreams[workstreamId].depends_on : [];
    for (const dependencyId of dependencies) {
      if (workstreams[dependencyId]) {
        visit(dependencyId, [...lineage, workstreamId]);
      }
    }
    visiting.delete(workstreamId);
    visited.add(workstreamId);
  }

  for (const workstreamId of Object.keys(workstreams)) {
    visit(workstreamId, []);
  }
}

function validateRouting(raw, workstreamIds, errors) {
  if (raw.routing === undefined) {
    return;
  }

  if (!raw.routing || typeof raw.routing !== 'object' || Array.isArray(raw.routing)) {
    pushError(errors, 'routing_invalid', 'routing must be an object when provided');
    return;
  }

  const workstreamIdSet = new Set(workstreamIds);
  for (const [phase, route] of Object.entries(raw.routing)) {
    if (!VALID_PHASE_NAME.test(phase)) {
      pushError(errors, 'routing_phase_invalid', `routing phase "${phase}" must be lowercase alphanumeric starting with a letter (hyphens and underscores allowed)`);
    }

    if (!route || typeof route !== 'object' || Array.isArray(route)) {
      pushError(errors, 'routing_entry_invalid', `routing "${phase}" must be an object`);
      continue;
    }

    if ('entry_workstream' in route) {
      if (typeof route.entry_workstream !== 'string' || !route.entry_workstream.trim()) {
        pushError(errors, 'routing_entry_workstream_invalid', `routing "${phase}" entry_workstream must be a non-empty string`);
      } else if (!workstreamIdSet.has(route.entry_workstream)) {
        pushError(errors, 'routing_entry_workstream_unknown', `routing "${phase}" references undeclared workstream "${route.entry_workstream}"`);
      } else {
        const targetWorkstream = raw.workstreams?.[route.entry_workstream];
        if (targetWorkstream?.phase && targetWorkstream.phase !== phase) {
          pushError(errors, 'routing_phase_mismatch', `routing "${phase}" entry_workstream "${route.entry_workstream}" must belong to phase "${phase}"`);
        }
      }
    }
  }
}

function validateGates(raw, repoIds, errors) {
  if (raw.gates === undefined) {
    return;
  }

  if (!raw.gates || typeof raw.gates !== 'object' || Array.isArray(raw.gates)) {
    pushError(errors, 'gates_invalid', 'gates must be an object when provided');
    return;
  }

  const repoIdSet = new Set(repoIds);
  for (const [gateId, gate] of Object.entries(raw.gates)) {
    if (!VALID_ID.test(gateId)) {
      pushError(errors, 'gate_id_invalid', `gate id "${gateId}" must be lowercase alphanumeric, hyphen, or underscore`);
    }

    if (!gate || typeof gate !== 'object' || Array.isArray(gate)) {
      pushError(errors, 'gate_invalid', `gate "${gateId}" must be an object`);
      continue;
    }

    if ('requires_human_approval' in gate && typeof gate.requires_human_approval !== 'boolean') {
      pushError(errors, 'gate_requires_human_approval_invalid', `gate "${gateId}" requires_human_approval must be a boolean when provided`);
    }

    if ('requires_repos' in gate) {
      if (!Array.isArray(gate.requires_repos)) {
        pushError(errors, 'gate_requires_repos_invalid', `gate "${gateId}" requires_repos must be an array`);
      } else {
        const seenRepos = new Set();
        for (const repoId of gate.requires_repos) {
          if (typeof repoId !== 'string' || !repoId.trim()) {
            pushError(errors, 'gate_requires_repo_invalid', `gate "${gateId}" requires_repos entries must be non-empty strings`);
            continue;
          }

          if (seenRepos.has(repoId)) {
            pushError(errors, 'gate_requires_repo_duplicate', `gate "${gateId}" contains duplicate required repo "${repoId}"`);
            continue;
          }
          seenRepos.add(repoId);

          if (!repoIdSet.has(repoId)) {
            pushError(errors, 'gate_requires_repo_unknown', `gate "${gateId}" references undeclared repo "${repoId}"`);
          }
        }
      }
    }
  }
}

function normalizeRouting(rawRouting = {}) {
  return Object.fromEntries(
    Object.entries(rawRouting).map(([phase, route]) => [
      phase,
      {
        entry_workstream: route?.entry_workstream ?? null,
      },
    ]),
  );
}

function normalizeGates(rawGates = {}) {
  return Object.fromEntries(
    Object.entries(rawGates).map(([gateId, gate]) => [
      gateId,
      {
        requires_human_approval: gate?.requires_human_approval === true,
        requires_repos: Array.isArray(gate?.requires_repos) ? [...new Set(gate.requires_repos)] : [],
      },
    ]),
  );
}

function getCoordinatorPhaseOrder(config) {
  const routingPhases = Object.keys(config.routing || {});
  if (routingPhases.length > 0) {
    return routingPhases;
  }

  const phases = [];
  for (const workstreamId of config.workstream_order || []) {
    const phase = config.workstreams?.[workstreamId]?.phase;
    if (phase && !phases.includes(phase)) {
      phases.push(phase);
    }
  }
  return phases;
}

function sameOrderedValues(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function validateCoordinatorConfig(raw) {
  const errors = [];

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['config_invalid: agentxchain-multi.json must be a JSON object'] };
  }

  if (raw.schema_version !== '0.1') {
    pushError(errors, 'schema_version_invalid', 'schema_version must be "0.1"');
  }

  validateProject(raw, errors);
  const repoIds = validateRepos(raw, errors);
  const workstreamIds = validateWorkstreams(raw, repoIds, errors);
  validateRouting(raw, workstreamIds, errors);
  validateGates(raw, repoIds, errors);

  return { ok: errors.length === 0, errors };
}

export function normalizeCoordinatorConfig(raw) {
  return {
    schema_version: raw.schema_version,
    project: {
      id: raw.project.id.trim(),
      name: raw.project.name.trim(),
    },
    repo_order: Object.keys(raw.repos),
    repos: Object.fromEntries(
      Object.entries(raw.repos).map(([repoId, repo]) => [
        repoId,
        {
          path: repo.path.trim(),
          default_branch: typeof repo.default_branch === 'string' && repo.default_branch.trim()
            ? repo.default_branch.trim()
            : 'main',
          required: repo.required !== false,
        },
      ]),
    ),
    workstream_order: Object.keys(raw.workstreams),
    workstreams: Object.fromEntries(
      Object.entries(raw.workstreams).map(([workstreamId, workstream]) => [
        workstreamId,
        {
          phase: workstream.phase,
          repos: [...new Set(workstream.repos)],
          entry_repo: workstream.entry_repo,
          depends_on: Array.isArray(workstream.depends_on) ? [...new Set(workstream.depends_on)] : [],
          completion_barrier: workstream.completion_barrier,
          interface_alignment: normalizeDecisionIdsByRepo(workstream.interface_alignment),
          named_decisions: normalizeDecisionIdsByRepo(workstream.named_decisions),
        },
      ]),
    ),
    routing: normalizeRouting(raw.routing),
    gates: normalizeGates(raw.gates),
    hooks: raw.hooks && typeof raw.hooks === 'object' ? raw.hooks : {},
  };
}

export function resolveRepoPaths(config, workspacePath) {
  const errors = [];
  const resolved = {};
  const workspaceRoot = resolve(workspacePath);
  const coordinatorPhaseOrder = getCoordinatorPhaseOrder(config);

  for (const [repoId, repo] of Object.entries(config.repos)) {
    const resolvedPath = resolve(workspaceRoot, repo.path);
    resolved[repoId] = resolvedPath;

    if (!existsSync(resolvedPath)) {
      pushError(errors, 'repo_path_missing', `repo "${repoId}" path does not exist: ${resolvedPath}`);
      continue;
    }

    let stats;
    try {
      stats = statSync(resolvedPath);
    } catch (err) {
      pushError(errors, 'repo_path_unreadable', `repo "${repoId}" path could not be read: ${err.message}`);
      continue;
    }

    if (!stats.isDirectory()) {
      pushError(errors, 'repo_path_not_directory', `repo "${repoId}" path is not a directory: ${resolvedPath}`);
      continue;
    }

    const configPath = join(resolvedPath, 'agentxchain.json');
    if (!existsSync(configPath)) {
      pushError(errors, 'repo_not_governed', `repo "${repoId}" does not contain agentxchain.json`);
      continue;
    }

    let parsed;
    try {
      parsed = safeParseJson(readFileSync(configPath, 'utf8'));
    } catch (err) {
      pushError(errors, 'repo_not_governed', `repo "${repoId}" config could not be read: ${err.message}`);
      continue;
    }

    if (!parsed.ok) {
      pushError(errors, 'repo_not_governed', `repo "${repoId}" config is invalid JSON: ${parsed.errors.join(', ')}`);
      continue;
    }

    const normalized = loadNormalizedConfig(parsed.data, resolvedPath);
    if (!normalized?.ok || normalized.normalized?.protocol_mode !== 'governed') {
      const detail = normalized?.errors?.length ? ` (${normalized.errors.join(', ')})` : '';
      pushError(errors, 'repo_not_governed', `repo "${repoId}" is not a governed project${detail}`);
      continue;
    }

    const repoPhaseOrder = Object.keys(normalized.normalized?.routing || {});
    if (!sameOrderedValues(repoPhaseOrder, coordinatorPhaseOrder)) {
      pushError(
        errors,
        'repo_phase_alignment_invalid',
        `repo "${repoId}" routing phases [${repoPhaseOrder.join(', ')}] do not match coordinator phases [${coordinatorPhaseOrder.join(', ')}]`,
      );
    }
  }

  return { ok: errors.length === 0, resolved, errors };
}

export function loadCoordinatorConfig(workspacePath) {
  const workspaceRoot = resolve(workspacePath);
  const configPath = join(workspaceRoot, COORDINATOR_CONFIG_FILE);

  if (!existsSync(configPath)) {
    return {
      ok: false,
      config: null,
      errors: [`config_missing: No ${COORDINATOR_CONFIG_FILE} found at ${workspaceRoot}`],
    };
  }

  const parsed = safeParseJson(readFileSync(configPath, 'utf8'));
  if (!parsed.ok) {
    return {
      ok: false,
      config: null,
      errors: parsed.errors.map((error) => `config_invalid: ${error}`),
    };
  }

  const validation = validateCoordinatorConfig(parsed.data);
  if (!validation.ok) {
    return { ok: false, config: null, errors: validation.errors };
  }

  const normalized = normalizeCoordinatorConfig(parsed.data);
  const resolution = resolveRepoPaths(normalized, workspaceRoot);
  if (!resolution.ok) {
    return { ok: false, config: null, errors: resolution.errors };
  }

  return {
    ok: true,
    config: {
      ...normalized,
      workspace_path: workspaceRoot,
      repos: Object.fromEntries(
        Object.entries(normalized.repos).map(([repoId, repo]) => [
          repoId,
          {
            ...repo,
            resolved_path: resolution.resolved[repoId],
          },
        ]),
      ),
    },
    errors: [],
  };
}
