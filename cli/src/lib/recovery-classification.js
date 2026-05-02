const DOMAINS = ['ghost', 'budget', 'credential', 'crash'];
const OUTCOMES = ['recovered', 'exhausted', 'manual', 'pending'];

const EVENT_CLASSIFICATIONS = {
  auto_retried_ghost: {
    domain: 'ghost',
    severity: 'medium',
    outcome: 'recovered',
    mechanism: 'auto_retry',
    summary: 'Ghost turn reissued automatically',
  },
  ghost_retry_exhausted: {
    domain: 'ghost',
    severity: 'high',
    outcome: 'exhausted',
    mechanism: 'auto_retry',
    summary: 'Ghost retry budget exhausted',
  },
  auto_retried_productive_timeout: {
    domain: 'ghost',
    severity: 'medium',
    outcome: 'recovered',
    mechanism: 'auto_retry',
    summary: 'Productive timeout reissued automatically',
  },
  productive_timeout_retry_exhausted: {
    domain: 'ghost',
    severity: 'high',
    outcome: 'exhausted',
    mechanism: 'auto_retry',
    summary: 'Productive timeout retry budget exhausted',
  },
  budget_exceeded_warn: {
    domain: 'budget',
    severity: 'medium',
    outcome: 'pending',
    mechanism: 'config_change',
    summary: 'Budget warning threshold exceeded',
  },
  retained_claude_auth_escalation_reclassified: {
    domain: 'credential',
    severity: 'medium',
    outcome: 'pending',
    mechanism: 'env_refresh',
    summary: 'Claude credential escalation reclassified',
  },
  continuous_paused_active_run_recovered: {
    domain: 'crash',
    severity: 'medium',
    outcome: 'recovered',
    mechanism: 'loop_guard',
    summary: 'Paused continuous session recovered active run',
  },
  session_failed_recovered_active_run: {
    domain: 'crash',
    severity: 'medium',
    outcome: 'recovered',
    mechanism: 'loop_guard',
    summary: 'Failed continuous step recovered active run',
  },
};

function getEventPayload(event) {
  return event && typeof event.payload === 'object' && !Array.isArray(event.payload)
    ? event.payload
    : {};
}

function escalateSeverity(eventType, payload, severity) {
  if (eventType === 'ghost_retry_exhausted' && payload.exhaustion_reason === 'same_signature_repeat') {
    return 'critical';
  }
  if (eventType === 'budget_exceeded_warn' && typeof payload.remaining_usd === 'number' && payload.remaining_usd <= 0) {
    return 'high';
  }
  return severity;
}

function emptyOutcomeCounts() {
  return Object.fromEntries(OUTCOMES.map((outcome) => [outcome, 0]));
}

function emptyDomainCounts() {
  return Object.fromEntries(DOMAINS.map((domain) => [domain, { total: 0, ...emptyOutcomeCounts() }]));
}

function formatSummary(eventType, payload, fallback) {
  if (payload.recovery_class && typeof payload.recovery_class === 'string') return payload.recovery_class;
  if (payload.warning && typeof payload.warning === 'string') return payload.warning;
  if (payload.recovery_action && typeof payload.recovery_action === 'string') return payload.recovery_action;
  return fallback || eventType;
}

export function classifyRecoveryEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  const eventType = event.event_type || event.type;
  const base = EVENT_CLASSIFICATIONS[eventType];
  if (!base) return null;

  const payload = getEventPayload(event);
  return {
    domain: base.domain,
    severity: escalateSeverity(eventType, payload, base.severity),
    outcome: base.outcome,
    mechanism: base.mechanism,
  };
}

export function buildRecoveryClassificationReport(events) {
  const byDomain = emptyDomainCounts();
  const byOutcome = emptyOutcomeCounts();
  const timeline = [];

  for (const event of Array.isArray(events) ? events : []) {
    const classification = classifyRecoveryEvent(event);
    if (!classification) continue;

    byDomain[classification.domain].total += 1;
    byDomain[classification.domain][classification.outcome] += 1;
    byOutcome[classification.outcome] += 1;

    const eventType = event.event_type || event.type;
    const payload = getEventPayload(event);
    timeline.push({
      event_id: event.event_id || null,
      timestamp: event.timestamp || null,
      event_type: eventType,
      domain: classification.domain,
      severity: classification.severity,
      outcome: classification.outcome,
      mechanism: classification.mechanism,
      summary: formatSummary(eventType, payload, EVENT_CLASSIFICATIONS[eventType]?.summary),
    });
  }

  timeline.sort((left, right) => {
    const leftTime = Date.parse(left.timestamp || '');
    const rightTime = Date.parse(right.timestamp || '');
    const normalizedLeft = Number.isNaN(leftTime) ? Number.POSITIVE_INFINITY : leftTime;
    const normalizedRight = Number.isNaN(rightTime) ? Number.POSITIVE_INFINITY : rightTime;
    if (normalizedLeft !== normalizedRight) return normalizedLeft - normalizedRight;
    return String(left.event_id || '').localeCompare(String(right.event_id || ''), 'en');
  });

  const totalRecoveryEvents = timeline.length;
  const hasCritical = timeline.some((entry) => entry.severity === 'critical');
  const healthScore = hasCritical || byOutcome.exhausted > byOutcome.recovered
    ? 'critical'
    : (byOutcome.exhausted > 0 || byOutcome.manual > 0 ? 'degraded' : 'healthy');

  return {
    total_recovery_events: totalRecoveryEvents,
    by_domain: byDomain,
    by_outcome: byOutcome,
    timeline,
    health_score: healthScore,
  };
}
