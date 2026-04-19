function normalizeText(value) {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

export function getPhaseOrder(config) {
  if (Array.isArray(config?.phases) && config.phases.length > 0) {
    return config.phases
      .map((phase) => phase?.id)
      .filter((phaseId) => typeof phaseId === 'string' && phaseId.trim().length > 0);
  }
  return Object.keys(config?.routing || {});
}

export function buildGateToPhaseMap(config) {
  const mapping = {};
  for (const [phaseId, route] of Object.entries(config?.routing || {})) {
    const gateId = route?.exit_gate;
    if (typeof gateId === 'string' && gateId.trim().length > 0) {
      mapping[gateId] = phaseId;
    }
  }
  return mapping;
}

export function extractReferencedGateIds(text, config) {
  const haystack = normalizeText(text);
  if (!haystack) return [];

  return Object.keys(config?.gates || {}).filter((gateId) => haystack.includes(gateId.toLowerCase()));
}

function derivePhaseScopeFromGateIds(gateIds, config) {
  const gateToPhase = buildGateToPhaseMap(config);
  const matchedPhases = [...new Set(
    gateIds
      .map((gateId) => gateToPhase[gateId] || null)
      .filter(Boolean),
  )];
  return matchedPhases.length === 1 ? matchedPhases[0] : null;
}

export function derivePhaseScopeFromIntentMetadata(intentLike, config) {
  const explicitScope = typeof intentLike?.phase_scope === 'string' && intentLike.phase_scope.trim().length > 0
    ? intentLike.phase_scope.trim()
    : null;
  if (explicitScope) return explicitScope;
  if (!config) return null;

  const texts = [
    intentLike?.charter || '',
    ...(Array.isArray(intentLike?.acceptance_contract) ? intentLike.acceptance_contract : []),
  ];
  const gateIds = [...new Set(texts.flatMap((text) => extractReferencedGateIds(text, config)))];
  return derivePhaseScopeFromGateIds(gateIds, config);
}

export function deriveAcceptanceItemPhaseScope(item, fallbackPhaseScope, config) {
  if (!config) return fallbackPhaseScope || null;
  const gateIds = extractReferencedGateIds(item, config);
  const derived = derivePhaseScopeFromGateIds(gateIds, config);
  return derived || fallbackPhaseScope || null;
}

export function isPhaseExited(currentPhase, scopedPhase, config) {
  if (!currentPhase || !scopedPhase || !config) return false;
  const order = getPhaseOrder(config);
  const currentIndex = order.indexOf(currentPhase);
  const scopeIndex = order.indexOf(scopedPhase);
  if (currentIndex === -1 || scopeIndex === -1) return false;
  return currentIndex > scopeIndex;
}

export function isAcceptanceItemSatisfiedByGateState(item, state, config) {
  if (!state || !config) return false;
  const itemText = normalizeText(item);
  if (!itemText) return false;

  const gateIds = extractReferencedGateIds(item, config);
  if (gateIds.length === 0) return false;

  const hasGatePassLanguage = /\b(can advance|advance to|gate can advance|gate passes|gate passed|passes|passed)\b/.test(itemText);
  if (!hasGatePassLanguage) return false;

  return gateIds.some((gateId) => state?.phase_gate_status?.[gateId] === 'passed');
}

export function evaluateAcceptanceItemLifecycle(item, intakeContext, state, config) {
  const fallbackPhaseScope = typeof intakeContext?.phase_scope === 'string' && intakeContext.phase_scope.trim().length > 0
    ? intakeContext.phase_scope.trim()
    : null;
  const phaseScope = deriveAcceptanceItemPhaseScope(item, fallbackPhaseScope, config);
  return {
    phase_scope: phaseScope,
    phase_exited: isPhaseExited(state?.phase || null, phaseScope, config),
    satisfied_by_gate_state: isAcceptanceItemSatisfiedByGateState(item, state, config),
  };
}
