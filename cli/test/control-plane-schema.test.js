import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const SPEC_PATH = join(REPO_ROOT, 'api', 'v1', 'control-plane.openapi.yaml');
const spec = yaml.load(readFileSync(SPEC_PATH, 'utf8'));

/**
 * Collect all operationIds from the OpenAPI spec by walking paths -> methods.
 */
function collectOperations() {
  const ops = [];
  for (const [path, methods] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(methods)) {
      if (typeof operation === 'object' && operation.operationId) {
        ops.push({ path, method, ...operation });
      }
    }
  }
  return ops;
}

const operations = collectOperations();

/**
 * Frozen-spec endpoint table — the 29 endpoints defined in
 * AGENTXCHAIN_AI_CONTROL_PLANE_API_SPEC.md. Each entry is
 * [method, path_pattern, operationId].
 */
const FROZEN_ENDPOINTS = [
  // Tenancy (9)
  ['post', '/v1/orgs', 'createOrganization'],
  ['get', '/v1/orgs/{org_id}', 'getOrganization'],
  ['post', '/v1/orgs/{org_id}/workspaces', 'createWorkspace'],
  ['get', '/v1/orgs/{org_id}/workspaces', 'listWorkspaces'],
  ['get', '/v1/workspaces/{ws_id}', 'getWorkspace'],
  ['patch', '/v1/workspaces/{ws_id}', 'updateWorkspace'],
  ['post', '/v1/workspaces/{ws_id}/projects', 'createProject'],
  ['get', '/v1/workspaces/{ws_id}/projects', 'listProjects'],
  ['get', '/v1/projects/{proj_id}', 'getProject'],
  // Run Lifecycle (8)
  ['post', '/v1/projects/{proj_id}/runs', 'createRun'],
  ['get', '/v1/projects/{proj_id}/runs', 'listRuns'],
  ['get', '/v1/runs/{run_id}', 'getRun'],
  ['get', '/v1/runs/{run_id}/turns', 'listTurns'],
  ['get', '/v1/runs/{run_id}/turns/{turn_id}', 'getTurn'],
  ['get', '/v1/runs/{run_id}/decisions', 'getDecisions'],
  ['get', '/v1/runs/{run_id}/gates', 'getGates'],
  ['post', '/v1/runs/{run_id}/cancel', 'cancelRun'],
  // Approvals & Recovery (6)
  ['post', '/v1/runs/{run_id}/approve-transition', 'approveTransition'],
  ['post', '/v1/runs/{run_id}/turns/{turn_id}/accept', 'acceptTurn'],
  ['post', '/v1/runs/{run_id}/turns/{turn_id}/reject', 'rejectTurn'],
  ['post', '/v1/runs/{run_id}/checkpoint', 'checkpointRun'],
  ['post', '/v1/runs/{run_id}/restart', 'restartRun'],
  ['post', '/v1/runs/{run_id}/retry', 'retryTurn'],
  // Audit & Events (4)
  ['get', '/v1/runs/{run_id}/events', 'getRunEvents'],
  ['get', '/v1/workspaces/{ws_id}/audit', 'getWorkspaceAudit'],
  ['get', '/v1/runs/{run_id}/export', 'exportRun'],
  ['post', '/v1/projects/{proj_id}/import', 'importRun'],
  // Webhooks (2)
  ['post', '/v1/workspaces/{ws_id}/webhooks', 'registerWebhook'],
  ['get', '/v1/workspaces/{ws_id}/webhooks', 'listWebhooks'],
];

describe('Control plane API schema compatibility — AT-CP-SCHEMA', () => {
  it('AT-CP-SCHEMA-001: OpenAPI spec is valid OpenAPI 3.1', () => {
    // Top-level structure
    assert.equal(spec.openapi, '3.1.0', 'OpenAPI version must be 3.1.0');
    assert.ok(spec.info, 'info block is required');
    assert.equal(spec.info.title, 'AgentXchain Control Plane API');
    assert.equal(spec.info.version, '0.1.0');
    assert.ok(spec.paths, 'paths is required');
    assert.ok(spec.components, 'components is required');
    assert.ok(spec.components.schemas, 'components.schemas is required');
    assert.ok(spec.components.securitySchemes, 'components.securitySchemes is required');

    // Security schemes
    assert.ok(spec.components.securitySchemes.api_key, 'api_key security scheme required');
    assert.equal(spec.components.securitySchemes.api_key.type, 'apiKey');
    assert.equal(spec.components.securitySchemes.api_key.in, 'header');
    assert.equal(spec.components.securitySchemes.api_key.name, 'X-API-Key');
    assert.ok(spec.components.securitySchemes.bearer_auth, 'bearer_auth security scheme required');
    assert.equal(spec.components.securitySchemes.bearer_auth.type, 'http');
    assert.equal(spec.components.securitySchemes.bearer_auth.scheme, 'bearer');

    // Global security requirement
    assert.ok(Array.isArray(spec.security), 'global security requirement must be an array');
    assert.ok(spec.security.length > 0, 'at least one global security requirement');

    // Every operation has operationId, responses, and tags
    for (const op of operations) {
      assert.ok(op.operationId, `operation ${op.method} ${op.path} missing operationId`);
      assert.ok(op.responses, `operation ${op.operationId} missing responses`);
      assert.ok(Array.isArray(op.tags) && op.tags.length > 0,
        `operation ${op.operationId} missing tags`);
    }
  });

  it('AT-CP-SCHEMA-002: every frozen-spec endpoint has a corresponding OpenAPI operation (29 operations)', () => {
    assert.equal(operations.length, 29, `expected 29 operations, got ${operations.length}`);

    const opIndex = new Map();
    for (const op of operations) {
      opIndex.set(`${op.method}:${op.path}`, op.operationId);
    }

    for (const [method, path, expectedId] of FROZEN_ENDPOINTS) {
      const actualId = opIndex.get(`${method}:${path}`);
      assert.ok(actualId, `missing endpoint: ${method.toUpperCase()} ${path} (expected operationId: ${expectedId})`);
      assert.equal(actualId, expectedId,
        `operationId mismatch for ${method.toUpperCase()} ${path}: expected ${expectedId}, got ${actualId}`);
    }
  });

  it('AT-CP-SCHEMA-003: Run response schema matches state.json structure', () => {
    const runSchema = spec.components.schemas.Run;
    assert.ok(runSchema, 'Run schema must exist');
    assert.ok(runSchema.required, 'Run schema must have required fields');

    const requiredFields = ['id', 'proj_id', 'phase', 'status', 'turns', 'gates',
      'decision_ledger', 'created_at', 'updated_at'];
    for (const field of requiredFields) {
      assert.ok(runSchema.required.includes(field),
        `Run schema missing required field: ${field}`);
    }

    // Verify field types match protocol state
    assert.ok(runSchema.properties.phase.enum.includes('planning'), 'phase must include planning');
    assert.ok(runSchema.properties.phase.enum.includes('implementation'), 'phase must include implementation');
    assert.ok(runSchema.properties.phase.enum.includes('qa'), 'phase must include qa');
    assert.ok(runSchema.properties.status.enum.includes('active'), 'status must include active');
    assert.ok(runSchema.properties.status.enum.includes('completed'), 'status must include completed');
    assert.equal(runSchema.properties.turns.type, 'array', 'turns must be an array');
    assert.equal(runSchema.properties.gates.type, 'object', 'gates must be an object');
    assert.equal(runSchema.properties.decision_ledger.type, 'array', 'decision_ledger must be an array');
  });

  it('AT-CP-SCHEMA-004: Turn response schema matches history.jsonl entry structure', () => {
    const turnSchema = spec.components.schemas.Turn;
    assert.ok(turnSchema, 'Turn schema must exist');
    assert.ok(turnSchema.required, 'Turn schema must have required fields');

    const requiredFields = ['id', 'run_id', 'role', 'runtime_id', 'status',
      'summary', 'files_changed', 'verification', 'artifact'];
    for (const field of requiredFields) {
      assert.ok(turnSchema.required.includes(field),
        `Turn schema missing required field: ${field}`);
    }

    // Verify nested structures
    assert.equal(turnSchema.properties.files_changed.type, 'array', 'files_changed must be an array');
    assert.equal(turnSchema.properties.verification.type, 'object', 'verification must be an object');
    assert.ok(turnSchema.properties.verification.properties.status,
      'verification must have status field');
    assert.ok(turnSchema.properties.verification.properties.status.enum.includes('pass'),
      'verification.status must include pass');
    assert.equal(turnSchema.properties.artifact.type, 'object', 'artifact must be an object');
    assert.ok(turnSchema.properties.artifact.properties.type.enum.includes('workspace'),
      'artifact.type must include workspace');
    assert.ok(turnSchema.properties.artifact.properties.type.enum.includes('commit'),
      'artifact.type must include commit');
  });

  it('AT-CP-SCHEMA-005: Decision response schema matches decision-ledger.jsonl entry structure', () => {
    const decisionSchema = spec.components.schemas.Decision;
    assert.ok(decisionSchema, 'Decision schema must exist');
    assert.ok(decisionSchema.required, 'Decision schema must have required fields');

    const requiredFields = ['id', 'category', 'statement', 'rationale'];
    for (const field of requiredFields) {
      assert.ok(decisionSchema.required.includes(field),
        `Decision schema missing required field: ${field}`);
    }

    // Verify category enum matches protocol
    assert.ok(decisionSchema.properties.category.enum.includes('implementation'),
      'category must include implementation');
    assert.ok(decisionSchema.properties.category.enum.includes('architecture'),
      'category must include architecture');
    assert.ok(decisionSchema.properties.category.enum.includes('scope'),
      'category must include scope');

    // Verify id pattern
    assert.ok(decisionSchema.properties.id.pattern,
      'Decision id must have a pattern');
    assert.match(decisionSchema.properties.id.pattern, /DEC/,
      'Decision id pattern must reference DEC prefix');
  });

  it('AT-CP-SCHEMA-006: protocol bridge exports cover all mutating API operations', async () => {
    const bridge = await import('../src/lib/api/protocol-bridge.js');

    // All mutating bridge functions that map to API endpoints
    const requiredBridgeExports = [
      'createRun',        // POST /runs
      'cancelRun',        // POST /runs/:id/cancel
      'acceptTurnResult', // POST /turns/:id/accept
      'rejectTurnResult', // POST /turns/:id/reject
      'approveTransition', // POST /approve-transition
      'checkpointTurn',   // POST /checkpoint
      'retryTurn',        // POST /retry
      'exportRun',        // GET /export (read-only but transforms data)
    ];

    for (const name of requiredBridgeExports) {
      assert.equal(typeof bridge[name], 'function',
        `bridge must export function: ${name}`);
    }

    // Verify error classes are exported
    const requiredErrors = [
      'ProtocolError',
      'NotFoundError',
      'ValidationError',
      'AuthorizationError',
      'ConflictError',
    ];
    for (const name of requiredErrors) {
      assert.equal(typeof bridge[name], 'function',
        `bridge must export error class: ${name}`);
    }

    // Verify read functions are also exported
    const readExports = [
      'getRunState',
      'listRuns',
      'getTurns',
      'getTurn',
      'getEvents',
      'getDecisions',
      'getGates',
    ];
    for (const name of readExports) {
      assert.equal(typeof bridge[name], 'function',
        `bridge must export read function: ${name}`);
    }
  });

  it('AT-CP-SCHEMA-007: no governance-affecting fields in cloud-only metadata', () => {
    // Allowed cloud-only fields per frozen spec
    const ALLOWED_CLOUD_ONLY = new Set([
      'display_name',
      'notification_preferences',
      'dashboard_layout',
      'search_index_state',
    ]);

    // Protocol-normative schemas that must not contain cloud-only governance fields
    const governanceSchemas = ['Run', 'Turn', 'Decision', 'Gate', 'Event'];

    for (const schemaName of governanceSchemas) {
      const schema = spec.components.schemas[schemaName];
      assert.ok(schema, `schema ${schemaName} must exist`);

      const props = Object.keys(schema.properties || {});
      for (const prop of props) {
        if (ALLOWED_CLOUD_ONLY.has(prop)) {
          // Cloud-only field is present — verify it has no governance semantics
          // by checking it is NOT in the required array
          const isRequired = (schema.required || []).includes(prop);
          assert.ok(!isRequired,
            `cloud-only field "${prop}" in ${schemaName} must not be required (would affect governance)`);
          continue;
        }
        // Non-cloud-only fields are fine — they're protocol fields
      }
    }

    // Verify no cloud-only fields exist in Decision or Gate schemas at all
    // (these are pure governance schemas with no presentation concerns)
    for (const pureSchema of ['Decision', 'Gate']) {
      const schema = spec.components.schemas[pureSchema];
      const props = Object.keys(schema.properties || {});
      for (const prop of props) {
        assert.ok(!ALLOWED_CLOUD_ONLY.has(prop),
          `pure governance schema ${pureSchema} must not contain cloud-only field: ${prop}`);
      }
    }
  });
});
