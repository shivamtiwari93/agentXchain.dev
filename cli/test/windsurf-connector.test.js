import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { isWindsurfLocalCliRuntime } from '../src/lib/claude-local-auth.js';
import { validateLocalCliCommandCompatibility } from '../src/lib/adapters/local-cli-adapter.js';
import { loadNormalizedConfig } from '../src/lib/normalized-config.js';

describe('Windsurf IDE connector — binary detection', () => {
  it('returns true for bare windsurf command', () => {
    assert.equal(isWindsurfLocalCliRuntime({ command: 'windsurf' }), true);
  });

  it('returns true for absolute path to windsurf binary', () => {
    assert.equal(isWindsurfLocalCliRuntime({ command: '/usr/local/bin/windsurf' }), true);
  });

  it('returns true for windsurf command array with flags', () => {
    assert.equal(isWindsurfLocalCliRuntime({ command: ['windsurf', '--agent'] }), true);
  });

  it('returns false for claude command', () => {
    assert.equal(isWindsurfLocalCliRuntime({ command: 'claude' }), false);
  });

  it('returns false for cursor command', () => {
    assert.equal(isWindsurfLocalCliRuntime({ command: 'cursor' }), false);
  });

  it('returns false for empty command', () => {
    assert.equal(isWindsurfLocalCliRuntime({ command: '' }), false);
  });

  it('returns false for undefined runtime', () => {
    assert.equal(isWindsurfLocalCliRuntime(undefined), false);
  });
});

describe('Windsurf IDE connector — command validation', () => {
  it('rejects windsurf command without --agent flag', () => {
    const result = validateLocalCliCommandCompatibility({
      command: 'windsurf',
      args: [],
      runtimeId: 'windsurf-agent',
    });
    assert.equal(result.ok, false);
    assert.equal(result.error_class, 'local_cli_command_incompatible');
    assert.equal(result.diagnostic.rule, 'windsurf_requires_agent_mode');
    assert.match(result.recovery, /--agent/);
  });

  it('accepts windsurf command with --agent flag', () => {
    const result = validateLocalCliCommandCompatibility({
      command: 'windsurf',
      args: ['--agent'],
      runtimeId: 'windsurf-agent',
    });
    assert.equal(result.ok, true);
  });

  it('rejects absolute-path windsurf without --agent flag', () => {
    const result = validateLocalCliCommandCompatibility({
      command: '/Applications/Windsurf.app/Contents/Resources/windsurf',
      args: [],
      runtimeId: 'windsurf-local',
    });
    assert.equal(result.ok, false);
    assert.equal(result.diagnostic.rule, 'windsurf_requires_agent_mode');
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

describe('Windsurf IDE connector — config validation roundtrip', () => {
  it('accepts a Windsurf runtime config as valid local_cli', () => {
    const raw = {
      schema_version: '1.0',
      project: { id: 'windsurf-test', name: 'Windsurf Test' },
      runtimes: {
        'windsurf-agent': {
          type: 'local_cli',
          command: ['windsurf', '--agent'],
          prompt_transport: 'dispatch_bundle_only',
          startup_watchdog_ms: 300000,
        },
      },
      roles: {
        dev: {
          title: 'Developer',
          mandate: 'Implement features.',
          write_authority: 'authoritative',
          runtime: 'windsurf-agent',
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
    assert.ok(result.normalized.runtimes['windsurf-agent']);
    assert.equal(result.normalized.runtimes['windsurf-agent'].type, 'local_cli');
  });
});
