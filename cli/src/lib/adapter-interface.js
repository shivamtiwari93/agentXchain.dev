/**
 * Adapter Interface — declared public boundary for shipped adapter dispatch.
 *
 * This module gives external runners a stable way to reuse the first-party
 * adapters without importing deep internal source paths.
 */

export {
  printManualDispatchInstructions,
  waitForStagedResult,
  readStagedResult,
} from './adapters/manual-adapter.js';

export {
  dispatchLocalCli,
  saveDispatchLogs,
  resolvePromptTransport,
} from './adapters/local-cli-adapter.js';

export { dispatchApiProxy } from './adapters/api-proxy-adapter.js';

export {
  DEFAULT_MCP_TOOL_NAME,
  DEFAULT_MCP_TRANSPORT,
  dispatchMcp,
  resolveMcpToolName,
  resolveMcpTransport,
  describeMcpRuntimeTarget,
} from './adapters/mcp-adapter.js';

export const ADAPTER_INTERFACE_VERSION = '0.1';
