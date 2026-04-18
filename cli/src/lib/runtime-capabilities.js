function normalizeMcpTransport(runtime) {
  return typeof runtime?.transport === 'string' && runtime.transport.trim()
    ? runtime.transport.trim()
    : 'stdio';
}

const DECLARABLE_CAPABILITY_FIELDS = new Set([
  'can_write_files',
  'proposal_support',
  'workflow_artifact_ownership',
]);

function mergeExplicitCapabilities(base, runtime) {
  const declared = runtime?.capabilities;
  if (!declared || typeof declared !== 'object' || Array.isArray(declared)) return base;
  const merged = { ...base };
  for (const field of DECLARABLE_CAPABILITY_FIELDS) {
    if (typeof declared[field] === 'string' && declared[field].length > 0) {
      merged[field] = declared[field];
    }
  }
  return merged;
}

export function getRuntimeCapabilityContract(runtime = {}) {
  switch (runtime?.type) {
    case 'manual':
      return mergeExplicitCapabilities({
        runtime_type: 'manual',
        transport: 'manual',
        can_write_files: 'direct',
        review_only_behavior: 'Manual review roles may create planning and review artifacts without claiming automated repo writes.',
        proposal_support: 'none',
        requires_local_binary: false,
        workflow_artifact_ownership: 'yes',
      }, runtime);

    case 'local_cli':
      return mergeExplicitCapabilities({
        runtime_type: 'local_cli',
        transport: 'local_cli',
        can_write_files: 'direct',
        review_only_behavior: 'Review-only bindings are invalid because local_cli exposes direct repo writes.',
        proposal_support: 'optional',
        requires_local_binary: true,
        workflow_artifact_ownership: 'yes',
      }, runtime);

    case 'api_proxy':
      return mergeExplicitCapabilities({
        runtime_type: 'api_proxy',
        transport: 'provider_api',
        can_write_files: 'proposal_only',
        review_only_behavior: 'Review-only turns return structured review artifacts only; they do not write repo files directly.',
        proposal_support: 'native',
        requires_local_binary: false,
        workflow_artifact_ownership: 'proposal_apply_required',
      }, runtime);

    case 'remote_agent':
      return mergeExplicitCapabilities({
        runtime_type: 'remote_agent',
        transport: 'remote_http',
        can_write_files: 'proposal_only',
        review_only_behavior: 'Review-only turns return JSON review results only; there is no proven local workspace write path.',
        proposal_support: 'native',
        requires_local_binary: false,
        workflow_artifact_ownership: 'proposal_apply_required',
      }, runtime);

    case 'mcp': {
      const transport = normalizeMcpTransport(runtime) === 'streamable_http'
        ? 'mcp_streamable_http'
        : 'mcp_stdio';
      return mergeExplicitCapabilities({
        runtime_type: 'mcp',
        transport,
        can_write_files: 'tool_defined',
        review_only_behavior: 'Review-only behavior depends on the configured MCP tool contract; AgentXchain only requires a valid governed turn result.',
        proposal_support: 'tool_defined',
        requires_local_binary: transport === 'mcp_stdio',
        workflow_artifact_ownership: 'tool_defined',
      }, runtime);
    }

    default:
      return mergeExplicitCapabilities({
        runtime_type: runtime?.type || 'unknown',
        transport: 'unknown',
        can_write_files: 'unknown',
        review_only_behavior: 'Unknown runtime type — capability contract is not defined.',
        proposal_support: 'unknown',
        requires_local_binary: false,
        workflow_artifact_ownership: 'unknown',
      }, runtime);
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

export function canRoleParticipateInRequiredFileProduction(role = {}, runtime = {}) {
  const contract = getRoleRuntimeCapabilityContract('__admission__', role, runtime);
  switch (contract.effective_write_path) {
    case 'direct':
    case 'planning_only':
    case 'patch_authoring':
    case 'proposal_apply_required':
    case 'tool_defined':
      return true;
    default:
      return false;
  }
}

export function canRoleSatisfyWorkflowArtifactOwnership(role = {}, runtime = {}) {
  const contract = getRoleRuntimeCapabilityContract('__ownership__', role, runtime);
  switch (contract.workflow_artifact_ownership) {
    case 'yes':
    case 'proposal_apply_required':
    case 'tool_defined':
      return true;
    default:
      return false;
  }
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

export { DECLARABLE_CAPABILITY_FIELDS };

export function getCapabilityDeclarationWarnings(runtime = {}) {
  const warnings = [];
  const declared = runtime?.capabilities;
  if (!declared || typeof declared !== 'object' || Array.isArray(declared)) return warnings;
  if (declared.can_write_files === 'direct' && (runtime.type === 'api_proxy' || runtime.type === 'remote_agent')) {
    warnings.push(`Runtime type "${runtime.type}" declares can_write_files=direct, which the reference runner does not support in v1. A third-party runner may.`);
  }
  return warnings;
}

export function summarizeRoleRuntimeCapability(contract) {
  return [
    `${contract.role_id}(${contract.role_write_authority})`,
    `path=${contract.effective_write_path}`,
    `owned_by=${contract.workflow_artifact_ownership}`,
  ].join('; ');
}
