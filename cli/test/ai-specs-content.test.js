import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

describe('agentxchain.ai planning contracts', () => {
  it('execution plane resolves fairness, lease defaults, progress events, and v1 worker trust model', () => {
    const spec = read('.planning/AGENTXCHAIN_AI_EXECUTION_PLANE_SPEC.md');

    assert.match(spec, /round-robin across projects/i,
      'execution plane must define fair cross-project scheduling under workspace caps');
    assert.match(spec, /local_cli`: 30 minutes/i,
      'execution plane must freeze a realistic local_cli default lease');
    assert.match(spec, /api_proxy`: 10 minutes/i,
      'execution plane must freeze an api_proxy default lease');
    assert.match(spec, /manual`: not execution-plane leased/i,
      'manual work must stay outside worker lease semantics');
    assert.match(spec, /execution_started/i,
      'execution plane must require structured progress events');
    assert.match(spec, /execution_progress/i,
      'execution plane must require execution_progress events');
    assert.match(spec, /verification_started/i,
      'execution plane must require verification progress events');
    assert.match(spec, /service-operated only/i,
      'execution plane must freeze the v1 worker trust model');
    assert.match(spec, /customer-provided workers.*deferred/i,
      'execution plane must explicitly defer BYO workers');
  });

  it('dashboard mutation spec forbids cloud-only actions and requires explicit recovery targets', () => {
    const spec = read('.planning/AGENTXCHAIN_AI_DASHBOARD_MUTATION_SPEC.md');

    assert.match(spec, /POST \/v1\/runs\/:run_id\/turns\/:turn_id\/accept/);
    assert.match(spec, /POST \/v1\/runs\/:run_id\/turns\/:turn_id\/reject/);
    assert.match(spec, /POST \/v1\/runs\/:run_id\/approve-transition/);
    assert.match(spec, /POST \/v1\/runs\/:run_id\/checkpoint/);
    assert.match(spec, /POST \/v1\/runs\/:run_id\/restart/);
    assert.match(spec, /POST \/v1\/runs\/:run_id\/retry/);
    assert.match(spec, /`checkpoint` requires the exact `turn_id`/i,
      'checkpoint must target an explicit accepted turn');
    assert.match(spec, /`restart` requires the exact `checkpoint_id`/i,
      'restart must target an explicit checkpoint');
    assert.match(spec, /`retry` requires the exact `turn_id`/i,
      'retry must target an explicit turn');
    assert.match(spec, /X-Idempotency-Key/i,
      'dashboard mutations must use an idempotency key');
    assert.match(spec, /Event streams, WebSockets, and SSE stay read-only/i,
      'dashboard mutation transport must remain HTTP-only');
    assert.match(spec, /force_accept|skip_verification|resume_latest/i,
      'dashboard mutation spec must name forbidden cloud-only shortcuts');
    assert.match(spec, /next_actions\[\]/i,
      'dashboard mutation responses must include canonical follow-up actions');
  });

  it('control plane recovery endpoints require explicit identifiers for checkpoint, restart, and retry', () => {
    const spec = read('.planning/AGENTXCHAIN_AI_CONTROL_PLANE_API_SPEC.md');

    assert.match(spec, /checkpoint a specific accepted turn/i,
      'control plane spec must scope checkpoint to an explicit accepted turn');
    assert.match(spec, /restart from a specific checkpoint/i,
      'control plane spec must scope restart to an explicit checkpoint');
    assert.match(spec, /retry a specific failed or failed_acceptance turn/i,
      'control plane spec must scope retry to an explicit turn');
    assert.match(spec, /must pass explicit target identifiers/i,
      'control plane spec must forbid server-side "latest" inference for recovery mutations');
  });

  it('dashboard read-model spec requires server-projected actionability with version-gated stale-view enforcement', () => {
    const spec = read('.planning/AGENTXCHAIN_AI_DASHBOARD_READ_MODEL_SPEC.md');

    assert.match(spec, /GET \/v1\/runs\/:run_id\/actionability/,
      'read-model spec must define the actionability projection endpoint');
    assert.match(spec, /projection_version/,
      'read-model spec must define a monotonically increasing projection version');
    assert.match(spec, /If-Match.*projection_version/i,
      'read-model spec must require If-Match on mutations to enforce stale-view detection');
    assert.match(spec, /409 Conflict/,
      'read-model spec must return 409 Conflict on version mismatch');
    assert.match(spec, /actionability_changed/,
      'read-model spec must define event-stream invalidation signals');
    assert.match(spec, /Ineligible.*actions are omitted/i,
      'read-model spec must omit ineligible actions, not show them disabled');
    assert.match(spec, /same.*evaluators.*CLI/i,
      'read-model spec must require protocol evaluator parity with CLI');
    assert.match(spec, /pending_approvals.*turn_actions.*checkpoint_actions.*run_actions/s,
      'read-model spec must project four distinct action scopes');
    assert.match(spec, /No fallback to cached projections/i,
      'read-model spec must ban cached-projection fallback on endpoint failure');
    assert.match(spec, /AT-AIRM-010/,
      'read-model spec must include all 10 acceptance tests');
  });

  it('operator observability spec requires protocol-faithful live events, aggregation, and alerting without cloud-only semantics', () => {
    const spec = read('.planning/AGENTXCHAIN_AI_OPERATOR_OBSERVABILITY_SPEC.md');

    assert.match(spec, /GET \/v1\/runs\/:run_id\/events\/stream/,
      'observability spec must define SSE event stream endpoint');
    assert.match(spec, /same schema as.*events\.jsonl/i,
      'observability spec must require protocol-compatible event schema');
    assert.match(spec, /No cloud-only event types in v1/i,
      'observability spec must ban cloud-only event types');
    assert.match(spec, /Last-Event-ID/,
      'observability spec must define SSE reconnection protocol');
    assert.match(spec, /reconnection_gap/,
      'observability spec must handle reconnection gaps explicitly');
    assert.match(spec, /observation_summary/,
      'observability spec must require repo-observer-derived observation, not self-report');
    assert.match(spec, /evaluation_history/,
      'observability spec must expose gate evaluation history');
    assert.match(spec, /at-least-once.*idempotency/i,
      'observability spec must require reliable webhook delivery');
    assert.match(spec, /run_requires_approval.*run_stalled.*turn_failed_acceptance/s,
      'observability spec must define the v1 alert trigger set');
    assert.match(spec, /AT-OBS-010/,
      'observability spec must include all 10 acceptance tests');
  });

  it('portability spec keeps the v1 bundle as a standard flat tarball until scale evidence exists', () => {
    const spec = read('.planning/AGENTXCHAIN_AI_PORTABILITY_SPEC.md');

    assert.match(spec, /flat, standard tarball layout/i,
      'portability spec must freeze the v1 bundle format');
    assert.match(spec, /without a custom parser/i,
      'portability spec must preserve standard-tool readability');
    assert.match(spec, /JSONL-manifest-plus-embedded-blob streaming formats are deferred/i,
      'portability spec must defer custom streaming bundles until evidence exists');
    assert.match(spec, /AT-PORT-009/,
      'portability spec must guard standard-tool inspection explicitly');
  });
});
