/**
 * Normalized config loader for AgentXchain.
 *
 * Supports two config generations:
 *   - Legacy v3: the current CLI format (lock.json-centered, TALK.md routing)
 *   - Governed v4: the frozen spec format (orchestrator-owned state, structured turn results)
 *
 * Both are normalized into a single internal shape so that all downstream code
 * can operate without branching on config version.
 *
 * Design rule: Legacy projects are supported, not upgraded silently.
 * No automatic rewrite on read.
 */

const VALID_WRITE_AUTHORITIES = ['authoritative', 'proposed', 'review_only'];
const VALID_RUNTIME_TYPES = ['manual', 'local_cli', 'api_proxy'];
const VALID_PROMPT_TRANSPORTS = ['argv', 'stdin', 'dispatch_bundle_only'];
const VALID_PHASES = ['planning', 'implementation', 'qa'];

/**
 * Detect config generation from raw parsed JSON.
 * Returns 3, 4, or null if unrecognizable.
 */
export function detectConfigVersion(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.schema_version === '1.0' || raw.schema_version === 4) return 4;
  if (raw.version === 3) return 3;
  return null;
}

/**
 * Validate a governed v4 config.
 * Returns { ok, errors }.
 */
export function validateV4Config(data) {
  const errors = [];

  if (!data || typeof data !== 'object') {
    return { ok: false, errors: ['Config must be a JSON object'] };
  }

  // Top-level required sections
  if (!data.project || typeof data.project !== 'object') {
    errors.push('project must be an object with id and name');
  } else {
    if (typeof data.project.id !== 'string' || !data.project.id.trim()) errors.push('project.id must be a non-empty string');
    if (typeof data.project.name !== 'string' || !data.project.name.trim()) errors.push('project.name must be a non-empty string');
  }

  // Roles
  if (!data.roles || typeof data.roles !== 'object') {
    errors.push('roles must be an object');
  } else {
    for (const [id, role] of Object.entries(data.roles)) {
      if (!/^[a-z0-9_-]+$/.test(id)) errors.push(`Invalid role id: "${id}"`);
      if (!role || typeof role !== 'object') { errors.push(`Role "${id}" must be an object`); continue; }
      if (typeof role.title !== 'string' || !role.title.trim()) errors.push(`Role "${id}": title required`);
      if (typeof role.mandate !== 'string' || !role.mandate.trim()) errors.push(`Role "${id}": mandate required`);
      if (!VALID_WRITE_AUTHORITIES.includes(role.write_authority)) {
        errors.push(`Role "${id}": write_authority must be one of: ${VALID_WRITE_AUTHORITIES.join(', ')}`);
      }
      if (typeof role.runtime !== 'string' || !role.runtime.trim()) errors.push(`Role "${id}": runtime required`);
    }
  }

  // Runtimes
  if (!data.runtimes || typeof data.runtimes !== 'object') {
    errors.push('runtimes must be an object');
  } else {
    for (const [id, rt] of Object.entries(data.runtimes)) {
      if (!rt || typeof rt !== 'object') { errors.push(`Runtime "${id}" must be an object`); continue; }
      if (!VALID_RUNTIME_TYPES.includes(rt.type)) {
        errors.push(`Runtime "${id}": type must be one of: ${VALID_RUNTIME_TYPES.join(', ')}`);
      }
      // Validate prompt_transport for local_cli runtimes
      if (rt.type === 'local_cli' && rt.prompt_transport) {
        if (!VALID_PROMPT_TRANSPORTS.includes(rt.prompt_transport)) {
          errors.push(`Runtime "${id}": prompt_transport must be one of: ${VALID_PROMPT_TRANSPORTS.join(', ')}`);
        }
        if (rt.prompt_transport === 'argv') {
          // Verify {prompt} placeholder exists in command/args
          const parts = Array.isArray(rt.command) ? rt.command : [rt.command, ...(rt.args || [])];
          const hasPlaceholder = parts.some(p => typeof p === 'string' && p.includes('{prompt}'));
          if (!hasPlaceholder) {
            errors.push(`Runtime "${id}": prompt_transport is "argv" but command/args do not contain {prompt} placeholder`);
          }
        }
      }
      // Validate api_proxy required fields (Session #19 freeze)
      if (rt.type === 'api_proxy') {
        if (typeof rt.provider !== 'string' || !rt.provider.trim()) {
          errors.push(`Runtime "${id}": api_proxy requires "provider" (e.g. "anthropic", "openai")`);
        }
        if (typeof rt.model !== 'string' || !rt.model.trim()) {
          errors.push(`Runtime "${id}": api_proxy requires "model" (e.g. "claude-sonnet-4-6")`);
        }
        if (typeof rt.auth_env !== 'string' || !rt.auth_env.trim()) {
          errors.push(`Runtime "${id}": api_proxy requires "auth_env" (environment variable name for API key)`);
        }
      }
    }
  }

  // Cross-references: every role.runtime must reference an existing runtime
  if (data.roles && data.runtimes) {
    for (const [id, role] of Object.entries(data.roles)) {
      if (role.runtime && !data.runtimes[role.runtime]) {
        errors.push(`Role "${id}" references unknown runtime "${role.runtime}"`);
      }
    }
  }

  // Cross-reference: review_only roles should not use authoritative runtimes
  if (data.roles && data.runtimes) {
    for (const [id, role] of Object.entries(data.roles)) {
      if (role.write_authority === 'review_only' && role.runtime && data.runtimes[role.runtime]) {
        const rt = data.runtimes[role.runtime];
        if (rt.type === 'local_cli') {
          errors.push(`Role "${id}" is review_only but uses local_cli runtime "${role.runtime}" — review_only roles should not have authoritative write access`);
        }
      }
      // v1 api_proxy restriction: only review_only roles may bind to api_proxy runtimes (Session #19 freeze)
      if (role.runtime && data.runtimes[role.runtime]) {
        const rt = data.runtimes[role.runtime];
        if (rt.type === 'api_proxy' && role.write_authority !== 'review_only') {
          errors.push(`Role "${id}" has write_authority "${role.write_authority}" but uses api_proxy runtime "${role.runtime}" — v1 api_proxy only supports review_only roles`);
        }
      }
    }
  }

  // Routing (optional but validated if present)
  if (data.routing) {
    for (const [phase, route] of Object.entries(data.routing)) {
      if (!VALID_PHASES.includes(phase)) {
        errors.push(`Routing references unknown phase: "${phase}"`);
      }
      if (route.entry_role && data.roles && !data.roles[route.entry_role]) {
        errors.push(`Routing "${phase}": entry_role "${route.entry_role}" is not a defined role`);
      }
      if (route.allowed_next_roles && Array.isArray(route.allowed_next_roles)) {
        for (const r of route.allowed_next_roles) {
          if (r !== 'human' && data.roles && !data.roles[r]) {
            errors.push(`Routing "${phase}": allowed_next_roles references unknown role "${r}"`);
          }
        }
      }
    }
  }

  // Gates (optional but validated if present)
  if (data.gates) {
    if (data.routing) {
      for (const [, route] of Object.entries(data.routing)) {
        if (route.exit_gate && !data.gates[route.exit_gate]) {
          errors.push(`Routing references unknown gate: "${route.exit_gate}"`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Normalize a legacy v3 config into the internal shape.
 * Does NOT modify the original file — this is a read-time transformation.
 */
export function normalizeV3(raw) {
  const agents = {};
  if (raw.agents && typeof raw.agents === 'object') {
    for (const [id, agent] of Object.entries(raw.agents)) {
      agents[id] = {
        title: agent.name || id,
        mandate: agent.mandate || '',
        write_authority: inferWriteAuthority(id),
        runtime_class: inferRuntimeClass(id),
        runtime_id: `legacy-${id}`,
      };
    }
  }

  const runtimes = {};
  for (const [id, agent] of Object.entries(agents)) {
    runtimes[agent.runtime_id] = {
      type: agent.runtime_class,
    };
  }

  return {
    schema_version: 3,
    protocol_mode: 'legacy',
    project: {
      id: slugify(raw.project || 'unknown'),
      name: raw.project || 'Unknown Project',
      default_branch: 'main',
    },
    roles: agents,
    runtimes,
    routing: buildLegacyRouting(Object.keys(agents)),
    gates: {},
    budget: null,
    retention: {
      talk_strategy: 'append_only',
      history_strategy: 'jsonl_append_only',
    },
    rules: {
      challenge_required: raw.rules?.require_message ?? true,
      max_turn_retries: 2,
      max_deadlock_cycles: 2,
      max_consecutive_claims: raw.rules?.max_consecutive_claims ?? 2,
      verify_command: raw.rules?.verify_command ?? null,
      compress_after_words: raw.rules?.compress_after_words ?? null,
      ttl_minutes: raw.rules?.ttl_minutes ?? 20,
    },
    files: {
      talk: raw.talk_file || 'TALK.md',
      history: raw.history_file || 'history.jsonl',
      state: raw.state_file || 'state.json',
      log: raw.log || 'log.md',
    },
    compat: {
      next_owner_source: 'talk-md',
      lock_based_coordination: true,
      original_version: 3,
    },
  };
}

/**
 * Normalize a governed v4 config into the internal shape.
 */
export function normalizeV4(raw) {
  const roles = {};
  if (raw.roles) {
    for (const [id, role] of Object.entries(raw.roles)) {
      roles[id] = {
        title: role.title,
        mandate: role.mandate,
        write_authority: role.write_authority,
        runtime_class: raw.runtimes?.[role.runtime]?.type || 'manual',
        runtime_id: role.runtime,
      };
    }
  }

  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: {
      id: raw.project?.id || 'unknown',
      name: raw.project?.name || 'Unknown',
      default_branch: raw.project?.default_branch || 'main',
    },
    roles,
    runtimes: raw.runtimes || {},
    routing: raw.routing || {},
    gates: raw.gates || {},
    budget: raw.budget || null,
    retention: raw.retention || {
      talk_strategy: 'append_only',
      history_strategy: 'jsonl_append_only',
    },
    rules: {
      challenge_required: raw.rules?.challenge_required ?? true,
      max_turn_retries: raw.rules?.max_turn_retries ?? 2,
      max_deadlock_cycles: raw.rules?.max_deadlock_cycles ?? 2,
      max_consecutive_claims: null,
      verify_command: null,
      compress_after_words: null,
      ttl_minutes: null,
    },
    files: {
      talk: 'TALK.md',
      history: '.agentxchain/history.jsonl',
      state: '.agentxchain/state.json',
      log: null,
    },
    compat: {
      next_owner_source: 'state-json',
      lock_based_coordination: false,
      original_version: 4,
    },
  };
}

/**
 * Load and normalize a config from raw JSON.
 * Returns { ok, normalized, errors, version }.
 */
export function loadNormalizedConfig(raw) {
  const version = detectConfigVersion(raw);

  if (version === null) {
    return {
      ok: false,
      normalized: null,
      errors: ['Unrecognized config format. Expected version: 3 or schema_version: "1.0" / 4'],
      version: null,
    };
  }

  if (version === 3) {
    // Use the existing v3 validator for basic shape checks
    const errors = [];
    if (typeof raw.project !== 'string' || !raw.project.trim()) errors.push('project must be a non-empty string');
    if (!raw.agents || typeof raw.agents !== 'object') {
      errors.push('agents must be an object');
    } else {
      for (const [id, agent] of Object.entries(raw.agents)) {
        if (!/^[a-z0-9_-]+$/.test(id)) errors.push(`Invalid agent id: "${id}"`);
        if (!agent || typeof agent !== 'object') { errors.push(`Agent "${id}" must be an object`); continue; }
        if (typeof agent.name !== 'string' || !agent.name.trim()) errors.push(`Agent "${id}": name required`);
        if (typeof agent.mandate !== 'string' || !agent.mandate.trim()) errors.push(`Agent "${id}": mandate required`);
      }
    }
    if (errors.length > 0) {
      return { ok: false, normalized: null, errors, version: 3 };
    }
    return { ok: true, normalized: normalizeV3(raw), errors: [], version: 3 };
  }

  if (version === 4) {
    const validation = validateV4Config(raw);
    if (!validation.ok) {
      return { ok: false, normalized: null, errors: validation.errors, version: 4 };
    }
    return { ok: true, normalized: normalizeV4(raw), errors: [], version: 4 };
  }
}


// --- Internal helpers ---

function inferWriteAuthority(agentId) {
  const id = agentId.toLowerCase();
  if (id.includes('pm') || id.includes('product') || id.includes('manager')) return 'review_only';
  if (id.includes('qa') || id.includes('test') || id.includes('quality')) return 'review_only';
  if (id.includes('ux') || id.includes('design') || id.includes('reviewer')) return 'review_only';
  if (id.includes('director') || id.includes('lead') || id.includes('architect')) return 'review_only';
  return 'authoritative';
}

function inferRuntimeClass(agentId) {
  // In legacy mode, all agents are effectively manual (user pastes prompts)
  return 'manual';
}

function buildLegacyRouting(agentIds) {
  // Legacy doesn't have formal routing — build a simple pass-through
  return {
    default: {
      sequence: agentIds,
      exit_gate: null,
    },
  };
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
