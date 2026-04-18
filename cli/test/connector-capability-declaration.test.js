import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getRuntimeCapabilityContract,
  getCapabilityDeclarationWarnings,
  DECLARABLE_CAPABILITY_FIELDS,
  getRoleRuntimeCapabilityContract,
} from '../src/lib/runtime-capabilities.js';

describe('Connector capability self-declaration', () => {
  it('AT-CAP-DECL-001: no capabilities field preserves type-based contract (backward compat)', () => {
    const contract = getRuntimeCapabilityContract({ type: 'local_cli', command: ['echo'] });
    assert.equal(contract.can_write_files, 'direct');
    assert.equal(contract.proposal_support, 'optional');
    assert.equal(contract.workflow_artifact_ownership, 'yes');
    assert.equal(contract.runtime_type, 'local_cli');
  });

  it('AT-CAP-DECL-002: MCP runtime with explicit capabilities overrides tool_defined defaults', () => {
    const contract = getRuntimeCapabilityContract({
      type: 'mcp',
      command: ['my-tool'],
      capabilities: {
        can_write_files: 'direct',
        proposal_support: 'optional',
        workflow_artifact_ownership: 'yes',
      },
    });
    assert.equal(contract.can_write_files, 'direct', 'declared can_write_files should override tool_defined');
    assert.equal(contract.proposal_support, 'optional', 'declared proposal_support should override tool_defined');
    assert.equal(contract.workflow_artifact_ownership, 'yes', 'declared ownership should override tool_defined');
    assert.equal(contract.runtime_type, 'mcp', 'runtime_type stays derived from type');
    assert.equal(contract.transport, 'mcp_stdio', 'transport stays derived from type');
  });

  it('AT-CAP-DECL-003: unknown runtime type with declared capabilities uses declarations', () => {
    const contract = getRuntimeCapabilityContract({
      type: 'custom_runner',
      capabilities: {
        can_write_files: 'direct',
        proposal_support: 'native',
        workflow_artifact_ownership: 'yes',
      },
    });
    assert.equal(contract.runtime_type, 'custom_runner');
    assert.equal(contract.can_write_files, 'direct');
    assert.equal(contract.proposal_support, 'native');
    assert.equal(contract.workflow_artifact_ownership, 'yes');
    assert.equal(contract.transport, 'unknown', 'transport stays unknown for custom types');
  });

  it('AT-CAP-DECL-004: api_proxy with can_write_files=direct produces conformance warning', () => {
    const runtime = {
      type: 'api_proxy',
      provider: 'anthropic',
      capabilities: { can_write_files: 'direct' },
    };
    const contract = getRuntimeCapabilityContract(runtime);
    assert.equal(contract.can_write_files, 'direct', 'declared value is used');
    const warnings = getCapabilityDeclarationWarnings(runtime);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes('api_proxy'), 'warning mentions runtime type');
    assert.ok(warnings[0].includes('reference runner'), 'warning mentions reference runner limitation');
  });

  it('AT-CAP-DECL-005: unknown fields in capabilities are silently ignored', () => {
    const contract = getRuntimeCapabilityContract({
      type: 'local_cli',
      command: ['echo'],
      capabilities: {
        future_field: 'some_value',
        another_unknown: true,
      },
    });
    assert.equal(contract.can_write_files, 'direct', 'type default preserved');
    assert.equal(contract.proposal_support, 'optional', 'type default preserved');
    assert.equal(contract.future_field, undefined, 'unknown field not merged');
  });

  it('AT-CAP-DECL-006: capabilities as non-object is silently ignored', () => {
    const contract = getRuntimeCapabilityContract({
      type: 'local_cli',
      command: ['echo'],
      capabilities: 'invalid',
    });
    assert.equal(contract.can_write_files, 'direct', 'type default preserved');

    const contract2 = getRuntimeCapabilityContract({
      type: 'local_cli',
      command: ['echo'],
      capabilities: ['array'],
    });
    assert.equal(contract2.can_write_files, 'direct', 'type default preserved for array');
  });

  it('AT-CAP-DECL-007: partial capability declarations merge with type defaults', () => {
    const contract = getRuntimeCapabilityContract({
      type: 'mcp',
      command: ['my-tool'],
      capabilities: {
        can_write_files: 'direct',
        // proposal_support and workflow_artifact_ownership not declared
      },
    });
    assert.equal(contract.can_write_files, 'direct', 'declared field overrides');
    assert.equal(contract.proposal_support, 'tool_defined', 'undeclared field keeps type default');
    assert.equal(contract.workflow_artifact_ownership, 'tool_defined', 'undeclared field keeps type default');
  });

  it('AT-CAP-DECL-008: DECLARABLE_CAPABILITY_FIELDS is the correct set', () => {
    assert.ok(DECLARABLE_CAPABILITY_FIELDS instanceof Set);
    assert.equal(DECLARABLE_CAPABILITY_FIELDS.size, 3);
    assert.ok(DECLARABLE_CAPABILITY_FIELDS.has('can_write_files'));
    assert.ok(DECLARABLE_CAPABILITY_FIELDS.has('proposal_support'));
    assert.ok(DECLARABLE_CAPABILITY_FIELDS.has('workflow_artifact_ownership'));
  });

  it('AT-CAP-DECL-009: remote_agent with can_write_files=direct produces conformance warning', () => {
    const runtime = {
      type: 'remote_agent',
      endpoint: 'https://example.com',
      capabilities: { can_write_files: 'direct' },
    };
    const warnings = getCapabilityDeclarationWarnings(runtime);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes('remote_agent'));
  });

  it('AT-CAP-DECL-010: no warnings for valid capability overrides', () => {
    const warnings = getCapabilityDeclarationWarnings({
      type: 'mcp',
      command: ['my-tool'],
      capabilities: { can_write_files: 'direct' },
    });
    assert.equal(warnings.length, 0, 'MCP with direct write is valid');

    const warnings2 = getCapabilityDeclarationWarnings({
      type: 'local_cli',
      command: ['echo'],
      capabilities: { proposal_support: 'native' },
    });
    assert.equal(warnings2.length, 0, 'local_cli with native proposals is valid');
  });

  it('AT-CAP-DECL-011: authoritative role consumes declared direct-write capability for MCP runtime', () => {
    const contract = getRoleRuntimeCapabilityContract(
      'dev',
      { write_authority: 'authoritative' },
      {
        type: 'mcp',
        command: ['my-tool'],
        capabilities: {
          can_write_files: 'direct',
          workflow_artifact_ownership: 'yes',
        },
      }
    );
    assert.equal(contract.runtime_contract.can_write_files, 'direct');
    assert.equal(contract.effective_write_path, 'direct');
    assert.equal(contract.workflow_artifact_ownership, 'yes');
  });

  it('AT-CAP-DECL-012: proposed role consumes declared direct-write capability for MCP runtime', () => {
    const contract = getRoleRuntimeCapabilityContract(
      'dev',
      { write_authority: 'proposed' },
      {
        type: 'mcp',
        command: ['my-tool'],
        capabilities: {
          can_write_files: 'direct',
          workflow_artifact_ownership: 'yes',
        },
      }
    );
    assert.equal(contract.runtime_contract.can_write_files, 'direct');
    assert.equal(contract.effective_write_path, 'patch_authoring');
    assert.equal(contract.workflow_artifact_ownership, 'yes');
  });
});
