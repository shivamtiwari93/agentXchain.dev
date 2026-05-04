import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { isCursorLocalCliRuntime } from '../src/lib/claude-local-auth.js';
import { validateLocalCliCommandCompatibility } from '../src/lib/adapters/local-cli-adapter.js';
import { loadNormalizedConfig } from '../src/lib/normalized-config.js';

describe('Cursor IDE connector — binary detection', () => {
  it('returns true for bare cursor command', () => {
    assert.equal(isCursorLocalCliRuntime({ command: 'cursor' }), true);
  });

  it('returns true for absolute path to cursor binary', () => {
    assert.equal(isCursorLocalCliRuntime({ command: '/usr/local/bin/cursor' }), true);
  });

  it('returns true for cursor command array with flags', () => {
    assert.equal(isCursorLocalCliRuntime({ command: ['cursor', '--background-agent'] }), true);
  });

  it('returns false for claude command', () => {
    assert.equal(isCursorLocalCliRuntime({ command: 'claude' }), false);
  });

  it('returns false for codex command', () => {
    assert.equal(isCursorLocalCliRuntime({ command: 'codex' }), false);
  });

  it('returns false for empty command', () => {
    assert.equal(isCursorLocalCliRuntime({ command: '' }), false);
  });

  it('returns false for undefined runtime', () => {
    assert.equal(isCursorLocalCliRuntime(undefined), false);
  });
});

describe('Cursor IDE connector — command validation', () => {
  it('rejects cursor command without agent mode flag', () => {
    const result = validateLocalCliCommandCompatibility({
      command: 'cursor',
      args: [],
      runtimeId: 'cursor-agent',
    });
    assert.equal(result.ok, false);
    assert.equal(result.error_class, 'local_cli_command_incompatible');
    assert.equal(result.diagnostic.rule, 'cursor_requires_agent_mode');
    assert.match(result.recovery, /background.agent/i);
  });

  it('accepts cursor command with --background-agent flag', () => {
    const result = validateLocalCliCommandCompatibility({
      command: 'cursor',
      args: ['--background-agent'],
      runtimeId: 'cursor-agent',
    });
    assert.equal(result.ok, true);
  });

  it('accepts cursor command with agent subcommand', () => {
    const result = validateLocalCliCommandCompatibility({
      command: 'cursor',
      args: ['agent'],
      runtimeId: 'cursor-agent',
    });
    assert.equal(result.ok, true);
  });

  it('rejects absolute-path cursor without agent mode', () => {
    const result = validateLocalCliCommandCompatibility({
      command: '/Applications/Cursor.app/Contents/Resources/cursor',
      args: [],
      runtimeId: 'cursor-local',
    });
    assert.equal(result.ok, false);
    assert.equal(result.diagnostic.rule, 'cursor_requires_agent_mode');
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

  it('does not interfere with Codex validation rules', () => {
    const invalid = validateLocalCliCommandCompatibility({
      command: 'codex',
      args: ['--json'],
      runtimeId: 'local-codex',
    });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.diagnostic.rule, 'codex_requires_exec');

    const valid = validateLocalCliCommandCompatibility({
      command: 'codex',
      args: ['exec', '--json'],
      runtimeId: 'local-codex',
    });
    assert.equal(valid.ok, true);
  });
});

describe('Cursor IDE connector — config validation roundtrip', () => {
  it('accepts a Cursor runtime config as valid local_cli', () => {
    const raw = {
      schema_version: '1.0',
      project: { id: 'cursor-test', name: 'Cursor Test' },
      runtimes: {
        'cursor-agent': {
          type: 'local_cli',
          command: ['cursor', '--background-agent'],
          prompt_transport: 'dispatch_bundle_only',
          startup_watchdog_ms: 300000,
        },
      },
      roles: {
        dev: {
          title: 'Developer',
          mandate: 'Implement features.',
          write_authority: 'authoritative',
          runtime: 'cursor-agent',
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
    assert.ok(result.normalized.runtimes['cursor-agent']);
    assert.equal(result.normalized.runtimes['cursor-agent'].type, 'local_cli');
  });
});
