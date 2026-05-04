import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { isOpenCodeLocalCliRuntime } from '../src/lib/claude-local-auth.js';
import { validateLocalCliCommandCompatibility } from '../src/lib/adapters/local-cli-adapter.js';
import { loadNormalizedConfig } from '../src/lib/normalized-config.js';

describe('OpenCode CLI connector — binary detection', () => {
  it('returns true for bare opencode command', () => {
    assert.equal(isOpenCodeLocalCliRuntime({ command: 'opencode' }), true);
  });

  it('returns true for absolute path to opencode binary', () => {
    assert.equal(isOpenCodeLocalCliRuntime({ command: '/usr/local/bin/opencode' }), true);
  });

  it('returns true for opencode command array with flags', () => {
    assert.equal(isOpenCodeLocalCliRuntime({ command: ['opencode', '--non-interactive'] }), true);
  });

  it('returns false for claude command', () => {
    assert.equal(isOpenCodeLocalCliRuntime({ command: 'claude' }), false);
  });

  it('returns false for cursor command', () => {
    assert.equal(isOpenCodeLocalCliRuntime({ command: 'cursor' }), false);
  });

  it('returns false for empty command', () => {
    assert.equal(isOpenCodeLocalCliRuntime({ command: '' }), false);
  });

  it('returns false for undefined runtime', () => {
    assert.equal(isOpenCodeLocalCliRuntime(undefined), false);
  });
});

describe('OpenCode CLI connector — command validation', () => {
  it('rejects opencode command without --non-interactive flag', () => {
    const result = validateLocalCliCommandCompatibility({
      command: 'opencode',
      args: [],
      runtimeId: 'opencode-agent',
    });
    assert.equal(result.ok, false);
    assert.equal(result.error_class, 'local_cli_command_incompatible');
    assert.equal(result.diagnostic.rule, 'opencode_requires_non_interactive');
    assert.match(result.recovery, /--non-interactive/);
  });

  it('accepts opencode command with --non-interactive flag', () => {
    const result = validateLocalCliCommandCompatibility({
      command: 'opencode',
      args: ['--non-interactive'],
      runtimeId: 'opencode-agent',
    });
    assert.equal(result.ok, true);
  });

  it('rejects absolute-path opencode without --non-interactive flag', () => {
    const result = validateLocalCliCommandCompatibility({
      command: '/usr/local/bin/opencode',
      args: [],
      runtimeId: 'opencode-local',
    });
    assert.equal(result.ok, false);
    assert.equal(result.diagnostic.rule, 'opencode_requires_non_interactive');
  });

  it('does not interfere with Claude validation rules', () => {
    const invalid = validateLocalCliCommandCompatibility({
      command: 'claude',
      args: ['--print', '--output-format=stream-json'],
      runtimeId: 'local-claude',
    });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.diagnostic.rule, 'claude_print_stream_json_requires_verbose');

    const valid = validateLocalCliCommandCompatibility({
      command: 'claude',
      args: ['--print', '--output-format', 'stream-json', '--verbose'],
      runtimeId: 'local-claude',
    });
    assert.equal(valid.ok, true);
  });

  it('does not interfere with Cursor validation rules', () => {
    const invalid = validateLocalCliCommandCompatibility({
      command: 'cursor',
      args: [],
      runtimeId: 'cursor-agent',
    });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.diagnostic.rule, 'cursor_requires_agent_mode');

    const valid = validateLocalCliCommandCompatibility({
      command: 'cursor',
      args: ['--background-agent'],
      runtimeId: 'cursor-agent',
    });
    assert.equal(valid.ok, true);
  });

  it('does not interfere with Windsurf validation rules', () => {
    const invalid = validateLocalCliCommandCompatibility({
      command: 'windsurf',
      args: [],
      runtimeId: 'windsurf-agent',
    });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.diagnostic.rule, 'windsurf_requires_agent_mode');

    const valid = validateLocalCliCommandCompatibility({
      command: 'windsurf',
      args: ['--agent'],
      runtimeId: 'windsurf-agent',
    });
    assert.equal(valid.ok, true);
  });
});

describe('OpenCode CLI connector — config validation roundtrip', () => {
  it('accepts an OpenCode runtime config as valid local_cli', () => {
    const raw = {
      schema_version: '1.0',
      project: { id: 'opencode-test', name: 'OpenCode Test' },
      runtimes: {
        'opencode-agent': {
          type: 'local_cli',
          command: ['opencode', '--non-interactive'],
          prompt_transport: 'stdin',
          startup_watchdog_ms: 180000,
        },
      },
      roles: {
        dev: {
          title: 'Developer',
          mandate: 'Implement features.',
          write_authority: 'authoritative',
          runtime: 'opencode-agent',
        },
      },
      phases: ['planning', 'implementation', 'qa'],
      gates: {
        planning_signoff: { required_files: [] },
        implementation_complete: { required_files: [] },
        qa_ship_verdict: { required_files: [] },
      },
      routing: {
        planning: { allowed_next_roles: ['dev', 'human'] },
        implementation: { allowed_next_roles: ['dev', 'human'] },
        qa: { allowed_next_roles: ['human'] },
      },
    };

    const result = loadNormalizedConfig(raw);
    assert.equal(result.ok, true, `Expected config to validate: ${result.errors?.join(', ')}`);
    assert.ok(result.normalized.runtimes['opencode-agent']);
    assert.equal(result.normalized.runtimes['opencode-agent'].type, 'local_cli');
  });
});
