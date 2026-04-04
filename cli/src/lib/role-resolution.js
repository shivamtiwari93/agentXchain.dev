/**
 * Shared governed role-resolution contract for operator commands.
 *
 * Keeps `step` and `run` aligned on:
 *   - explicit role override validation
 *   - routing-legal next-role recommendations
 *   - phase entry-role fallback
 *   - first-role final fallback
 */

function getPhaseId(state, config) {
  if (state?.phase) {
    return state.phase;
  }

  const firstPhase = config?.phases?.[0];
  if (typeof firstPhase === 'string') {
    return firstPhase;
  }
  if (firstPhase?.id) {
    return firstPhase.id;
  }

  return null;
}

export function resolveGovernedRole({ override = null, state = null, config }) {
  const roles = Object.keys(config?.roles || {});
  const phase = getPhaseId(state, config);
  const routing = phase ? config?.routing?.[phase] : null;
  const warnings = [];

  if (override) {
    if (!config?.roles?.[override]) {
      return {
        roleId: null,
        warnings,
        error: `Unknown role: "${override}"`,
        availableRoles: roles,
        phase,
      };
    }

    if (routing?.allowed_next_roles && !routing.allowed_next_roles.includes(override) && override !== 'human') {
      warnings.push(`role "${override}" is not in allowed_next_roles for phase "${phase}"`);
    }

    return {
      roleId: override,
      warnings,
      error: null,
      availableRoles: roles,
      phase,
    };
  }

  if (state?.next_recommended_role && config?.roles?.[state.next_recommended_role]) {
    const recommended = state.next_recommended_role;
    const isLegal = !routing?.allowed_next_roles || routing.allowed_next_roles.includes(recommended);
    if (isLegal) {
      return {
        roleId: recommended,
        warnings,
        error: null,
        availableRoles: roles,
        phase,
      };
    }
  }

  if (routing?.entry_role && config?.roles?.[routing.entry_role]) {
    return {
      roleId: routing.entry_role,
      warnings,
      error: null,
      availableRoles: roles,
      phase,
    };
  }

  if (roles.length > 0) {
    warnings.push(
      phase
        ? `No entry_role for phase "${phase}". Defaulting to "${roles[0]}".`
        : `No routing phase resolved. Defaulting to "${roles[0]}".`,
    );
    return {
      roleId: roles[0],
      warnings,
      error: null,
      availableRoles: roles,
      phase,
    };
  }

  return {
    roleId: null,
    warnings,
    error: 'No roles defined in config.',
    availableRoles: roles,
    phase,
  };
}
