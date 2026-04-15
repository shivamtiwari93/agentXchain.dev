function normalizeMcpTransport(runtime) {
  return typeof runtime?.transport === 'string' && runtime.transport.trim()
    ? runtime.transport.trim()
    : 'stdio';
}

export function getRuntimeCapabilityContract(runtime = {}) {
  switch (runtime?.type) {
    case 'manual':
      return {
        runtime_type: 'manual',
        transport: 'manual',
        can_write_files: 'direct',
        review_only_behavior: 'Manual review roles may create planning and review artifacts without claiming automated repo writes.',
        proposal_support: 'none',
        requires_local_binary: false,
        workflow_artifact_ownership: 'yes',
      };

    case 'local_cli':
      return {
        runtime_type: 'local_cli',
        transport: 'local_cli',
        can_write_files: 'direct',
        review_only_behavior: 'Review-only bindings are invalid because local_cli exposes direct repo writes.',
        proposal_support: 'optional',
        requires_local_binary: true,
        workflow_artifact_ownership: 'yes',
      };

    case 'api_proxy':
      return {
        runtime_type: 'api_proxy',
        transport: 'provider_api',
        can_write_files: 'proposal_only',
        review_only_behavior: 'Review-only turns return structured review artifacts only; they do not write repo files directly.',
        proposal_support: 'native',
        requires_local_binary: false,
        workflow_artifact_ownership: 'proposal_apply_required',
      };

    case 'remote_agent':
      return {
        runtime_type: 'remote_agent',
        transport: 'remote_http',
        can_write_files: 'proposal_only',
        review_only_behavior: 'Review-only turns return JSON review results only; there is no proven local workspace write path.',
        proposal_support: 'native',
        requires_local_binary: false,
        workflow_artifact_ownership: 'proposal_apply_required',
      };

    case 'mcp': {
      const transport = normalizeMcpTransport(runtime) === 'streamable_http'
        ? 'mcp_streamable_http'
        : 'mcp_stdio';
      return {
        runtime_type: 'mcp',
        transport,
        can_write_files: 'tool_defined',
        review_only_behavior: 'Review-only behavior depends on the configured MCP tool contract; AgentXchain only requires a valid governed turn result.',
        proposal_support: 'tool_defined',
        requires_local_binary: transport === 'mcp_stdio',
        workflow_artifact_ownership: 'tool_defined',
      };
    }

    default:
      return {
        runtime_type: runtime?.type || 'unknown',
        transport: 'unknown',
        can_write_files: 'unknown',
        review_only_behavior: 'Unknown runtime type — capability contract is not defined.',
        proposal_support: 'unknown',
        requires_local_binary: false,
        workflow_artifact_ownership: 'unknown',
      };
  }
}

function appendNote(notes, message) {
  if (!message || notes.includes(message)) return;
  notes.push(message);
}

export function getRoleRuntimeCapabilityContract(roleId, role = {}, runtime = {}) {
  const base = getRuntimeCapabilityContract(runtime);
  const authority = role?.write_authority || 'unknown';
  const notes = [];
  let effectiveWritePath = 'unknown';
  let workflowArtifactOwnership = 'unknown';

  if (authority === 'review_only') {
    switch (runtime?.type) {
      case 'manual':
        effectiveWritePath = 'planning_only';
        workflowArtifactOwnership = 'yes';
        appendNote(notes, 'Manual review roles can satisfy workflow-kit ownership for planning artifacts.');
        break;
      case 'local_cli':
        effectiveWritePath = 'invalid_review_only_binding';
        workflowArtifactOwnership = 'invalid';
        appendNote(notes, 'review_only + local_cli is invalid because local_cli exposes direct repo writes.');
        break;
      case 'api_proxy':
      case 'remote_agent':
        effectiveWritePath = 'review_artifact_only';
        workflowArtifactOwnership = 'no';
        appendNote(notes, 'Review-only remote turns can attest and produce review artifacts, not workflow-kit files.');
        break;
      case 'mcp':
        effectiveWritePath = 'tool_defined';
        workflowArtifactOwnership = 'tool_defined';
        appendNote(notes, 'MCP review-only file production depends on the configured tool, not runtime type alone.');
        break;
      default:
        effectiveWritePath = 'unknown';
        workflowArtifactOwnership = 'unknown';
        break;
    }
  } else if (authority === 'proposed') {
    switch (runtime?.type) {
      case 'manual':
      case 'local_cli':
        effectiveWritePath = 'patch_authoring';
        workflowArtifactOwnership = 'yes';
        appendNote(notes, 'This role can prepare patch-shaped work while still satisfying workflow-kit artifact ownership.');
        break;
      case 'api_proxy':
      case 'remote_agent':
        effectiveWritePath = 'proposal_apply_required';
        workflowArtifactOwnership = 'proposal_apply_required';
        appendNote(notes, 'Accepted proposals are staged under .agentxchain/proposed and require proposal apply before gate files exist in the repo.');
        break;
      case 'mcp':
        effectiveWritePath = 'tool_defined';
        workflowArtifactOwnership = 'tool_defined';
        appendNote(notes, 'MCP proposed-authoring behavior depends on the governed tool implementation.');
        break;
      default:
        effectiveWritePath = 'unknown';
        workflowArtifactOwnership = 'unknown';
        break;
    }
  } else if (authority === 'authoritative') {
    switch (runtime?.type) {
      case 'manual':
      case 'local_cli':
        effectiveWritePath = 'direct';
        workflowArtifactOwnership = 'yes';
        break;
      case 'api_proxy':
      case 'remote_agent':
        effectiveWritePath = 'invalid_authoritative_binding';
        workflowArtifactOwnership = 'invalid';
        appendNote(notes, `${runtime.type} does not support authoritative roles in v1.`);
        break;
      case 'mcp':
        effectiveWritePath = 'tool_defined';
        workflowArtifactOwnership = 'tool_defined';
        appendNote(notes, 'MCP authoritative repo writes are tool-defined, not guaranteed by runtime type.');
        break;
      default:
        effectiveWritePath = 'unknown';
        workflowArtifactOwnership = 'unknown';
        break;
    }
  }

  return {
    role_id: roleId,
    role_write_authority: authority,
    effective_write_path: effectiveWritePath,
    workflow_artifact_ownership: workflowArtifactOwnership,
    notes,
    runtime_contract: base,
  };
}

export function summarizeRuntimeCapabilityContract(contract) {
  return [
    `transport=${contract.transport}`,
    `writes=${contract.can_write_files}`,
    `proposals=${contract.proposal_support}`,
    `owned_by=${contract.workflow_artifact_ownership}`,
    `binary=${contract.requires_local_binary ? 'yes' : 'no'}`,
  ].join('; ');
}

export function summarizeRoleRuntimeCapability(contract) {
  return [
    `${contract.role_id}(${contract.role_write_authority})`,
    `path=${contract.effective_write_path}`,
    `owned_by=${contract.workflow_artifact_ownership}`,
  ].join('; ');
}
