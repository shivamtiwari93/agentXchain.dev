const DISPATCH_ROOT = '.agentxchain/dispatch';
const DISPATCH_INDEX_PATH = `${DISPATCH_ROOT}/index.json`;
const DISPATCH_TURNS_DIR = `${DISPATCH_ROOT}/turns`;
const STAGING_ROOT = '.agentxchain/staging';

export function getDispatchTurnDir(turnId) {
  return `${DISPATCH_TURNS_DIR}/${turnId}`;
}

export function getDispatchPromptPath(turnId) {
  return `${getDispatchTurnDir(turnId)}/PROMPT.md`;
}

export function getDispatchContextPath(turnId) {
  return `${getDispatchTurnDir(turnId)}/CONTEXT.md`;
}

export function getDispatchAssignmentPath(turnId) {
  return `${getDispatchTurnDir(turnId)}/ASSIGNMENT.json`;
}

export function getDispatchApiRequestPath(turnId) {
  return `${getDispatchTurnDir(turnId)}/API_REQUEST.json`;
}

export function getDispatchTokenBudgetPath(turnId) {
  return `${getDispatchTurnDir(turnId)}/TOKEN_BUDGET.json`;
}

export function getDispatchEffectiveContextPath(turnId) {
  return `${getDispatchTurnDir(turnId)}/CONTEXT.effective.md`;
}

export function getDispatchLogPath(turnId) {
  return `${getDispatchTurnDir(turnId)}/stdout.log`;
}

export function getTurnStagingDir(turnId) {
  return `${STAGING_ROOT}/${turnId}`;
}

export function getTurnStagingResultPath(turnId) {
  return `${getTurnStagingDir(turnId)}/turn-result.json`;
}

export function getTurnProviderResponsePath(turnId) {
  return `${getTurnStagingDir(turnId)}/provider-response.json`;
}

export function getTurnApiErrorPath(turnId) {
  return `${getTurnStagingDir(turnId)}/api-error.json`;
}

export function getTurnRetryTracePath(turnId) {
  return `${getTurnStagingDir(turnId)}/retry-trace.json`;
}

export {
  DISPATCH_ROOT,
  DISPATCH_INDEX_PATH,
  DISPATCH_TURNS_DIR,
  STAGING_ROOT,
};
