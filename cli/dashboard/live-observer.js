export const LIVE_OBSERVER_STALE_MS = 15_000;

function formatEventScope(scope) {
  return scope === 'coordinator' ? 'coordinator' : 'run';
}

function resolveTimestamp(event) {
  if (typeof event?.timestamp === 'string' && event.timestamp.trim()) {
    return event.timestamp;
  }
  if (typeof event?.observedAt === 'string' && event.observedAt.trim()) {
    return `${event.observedAt} (observed)`;
  }
  return 'unknown time';
}

export function buildLiveMeta({
  connected,
  lastRefreshAt,
  lastEvent,
  scope = 'run',
  now = Date.now(),
  staleAfterMs = LIVE_OBSERVER_STALE_MS,
} = {}) {
  const refreshMs = typeof lastRefreshAt === 'string' ? new Date(lastRefreshAt).getTime() : Number.NaN;
  const hasRefresh = Number.isFinite(refreshMs);
  const scopeLabel = formatEventScope(scope);

  let freshnessState = 'connecting';
  let freshnessLabel = 'Connecting';

  if (!connected) {
    freshnessState = 'disconnected';
    freshnessLabel = 'Disconnected';
  } else if (hasRefresh) {
    freshnessState = (now - refreshMs) > staleAfterMs ? 'stale' : 'live';
    freshnessLabel = freshnessState === 'live' ? 'Live' : 'Stale';
  }

  const refreshDetail = hasRefresh
    ? `Updated ${lastRefreshAt}`
    : connected
      ? 'Waiting for first dashboard refresh'
      : 'Waiting for dashboard reconnect';

  const connectionDetail = connected ? 'WebSocket connected' : 'WebSocket disconnected';

  let eventDetail = `No ${scopeLabel} events observed yet`;
  if (lastEvent) {
    const repoSuffix = scope === 'coordinator' && lastEvent.repoId ? ` from ${lastEvent.repoId}` : '';
    eventDetail = `Last ${scopeLabel} event: ${lastEvent.type || 'unknown_event'}${repoSuffix} at ${resolveTimestamp(lastEvent)}`;
  }

  return {
    title: scope === 'coordinator' ? 'Live Coordinator Feed' : 'Live Run Feed',
    freshness_state: freshnessState,
    freshness_label: freshnessLabel,
    refresh_detail: refreshDetail,
    connection_detail: connectionDetail,
    event_detail: eventDetail,
  };
}

export function createLiveEventFromMessage(message, observedAt = new Date().toISOString()) {
  if (message?.type === 'event') {
    return {
      type: message.event?.event_type || 'unknown_event',
      timestamp: message.event?.timestamp || null,
      observedAt,
    };
  }

  if (message?.type === 'coordinator_event') {
    return {
      type: message.event?.event_type || 'unknown_event',
      timestamp: message.event?.timestamp || null,
      observedAt,
      repoId: message.repo_id || message.event?.repo_id || null,
    };
  }

  return null;
}

export function shouldRefreshViewForLiveMessage(viewName, messageType) {
  if (messageType === 'invalidate') return true;
  if (messageType === 'coordinator_event') {
    return viewName === 'cross-repo' || viewName === 'gate';
  }
  return false;
}
