/**
 * AgentXchain OpenClaw Plugin
 *
 * Exposes AgentXchain governance actions as OpenClaw skills:
 * - agentxchain_step: execute a governed turn step
 * - agentxchain_accept_turn: accept the current turn result
 * - agentxchain_approve_transition: approve a phase gate transition
 *
 * Each tool shells out to the agentxchain CLI and returns structured output.
 * Uses focused SDK subpath imports per OpenClaw plugin SDK docs.
 */

import { execFileSync } from 'node:child_process';

// ── Types ──────────────────────────────────────────────────────

interface ToolContext {
  working_directory: string;
  flags?: string;
}

interface ToolResult {
  success: boolean;
  output: string;
  exit_code: number;
}

interface PluginApi {
  registerTool(name: string, handler: (params: ToolContext) => ToolResult): void;
}

interface PluginEntry {
  register(api: PluginApi): void;
}

// ── CLI execution helper ───────────────────────────────────────

function runAgentxchainCommand(
  command: string,
  cwd: string,
  extraFlags?: string,
): ToolResult {
  const args = [command];
  if (extraFlags) {
    args.push(...extraFlags.split(/\s+/).filter(Boolean));
  }

  try {
    const output = execFileSync('agentxchain', args, {
      cwd,
      encoding: 'utf-8',
      timeout: 300_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { success: true, output: output.trim(), exit_code: 0 };
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    const stdout = typeof e.stdout === 'string' ? e.stdout : '';
    const stderr = typeof e.stderr === 'string' ? e.stderr : '';
    return {
      success: false,
      output: (stdout + '\n' + stderr).trim(),
      exit_code: typeof e.status === 'number' ? e.status : 1,
    };
  }
}

// ── Plugin entry point ─────────────────────────────────────────

export function definePluginEntry(): PluginEntry {
  return {
    register(api: PluginApi): void {
      api.registerTool('agentxchain_step', (params: ToolContext): ToolResult => {
        return runAgentxchainCommand('step', params.working_directory, params.flags);
      });

      api.registerTool('agentxchain_accept_turn', (params: ToolContext): ToolResult => {
        return runAgentxchainCommand('accept-turn', params.working_directory);
      });

      api.registerTool('agentxchain_approve_transition', (params: ToolContext): ToolResult => {
        return runAgentxchainCommand(
          'approve-transition',
          params.working_directory,
          params.flags,
        );
      });
    },
  };
}
