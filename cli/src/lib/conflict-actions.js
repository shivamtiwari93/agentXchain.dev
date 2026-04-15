export function deriveConflictedTurnResolutionActions(turnId) {
  if (typeof turnId !== 'string' || !turnId.trim()) {
    throw new Error('deriveConflictedTurnResolutionActions requires a non-empty turnId');
  }

  const normalizedTurnId = turnId.trim();
  return [
    {
      command: `agentxchain reject-turn --turn ${normalizedTurnId} --reassign`,
      description: 'reject and re-dispatch with conflict context',
    },
    {
      command: `agentxchain accept-turn --turn ${normalizedTurnId} --resolution human_merge`,
      description: 'manually merge and re-accept',
    },
  ];
}
