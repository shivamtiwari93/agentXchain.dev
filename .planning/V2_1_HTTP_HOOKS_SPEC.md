# V2.1 HTTP Hooks Spec — AgentXchain

> Standalone spec for HTTP hook transport. Companion to process hooks in hook-runner.js.

---

## Purpose

Allow governed hooks to call external HTTP services (compliance APIs, policy engines, Slack webhooks, PagerDuty) without shell-script wrappers. The HTTP transport inherits the same phase semantics, verdict model, and tamper protections as process hooks. Only the transport changes.

---

## Interface

### Hook Config

```json
{
  "after_dispatch": [
    {
      "name": "compliance-check",
      "type": "http",
      "url": "https://compliance.internal/api/v1/check",
      "method": "POST",
      "timeout_ms": 5000,
      "mode": "blocking",
      "headers": {
        "Authorization": "Bearer ${COMPLIANCE_API_TOKEN}",
        "X-Custom": "static-value"
      }
    }
  ]
}
```

### Config Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Hook name (same `^[a-z0-9_-]+$` constraint) |
| `type` | `"http"` | yes | Transport type |
| `url` | string | yes | HTTP(S) endpoint URL |
| `method` | `"POST"` | yes | Only POST is supported in v2.1 |
| `timeout_ms` | integer | yes | 100–30000ms |
| `mode` | `"blocking"` or `"advisory"` | yes | Same semantics as process hooks |
| `headers` | object | no | Key-value pairs; values support `${ENV_VAR}` interpolation |
| `env` | object | no | Additional env vars for header interpolation |

### Request Body

The HTTP hook receives the same envelope as process hooks receive on stdin:

```json
{
  "hook_phase": "after_dispatch",
  "hook_name": "compliance-check",
  "run_id": "run_abc123",
  "project_root": "/path/to/repo",
  "timestamp": "2026-04-02T12:00:00.000Z",
  "payload": { ... }
}
```

### Expected Response

Same verdict JSON that process hooks write to stdout:

```json
{
  "verdict": "allow",
  "message": "Compliance check passed",
  "annotations": [
    { "key": "compliance_ticket", "value": "COMP-4521" }
  ]
}
```

---

## Behavior

1. Header values containing `${VAR_NAME}` are resolved from the hook's `env` object first, then from `process.env`. Unresolvable variables cause a validation error at config load time, not at execution time.
2. The request body is `Content-Type: application/json`.
3. HTTP status 2xx with valid verdict JSON → treated as successful execution.
4. HTTP status 2xx with invalid JSON → treated as process failure (same as invalid stdout from process hooks).
5. HTTP status 4xx/5xx → treated as process failure.
6. Timeout → same fail-closed/advisory semantics as process hooks.
7. Network errors (DNS failure, connection refused, TLS error) → treated as process failure.
8. Tamper detection on protected files still runs before and after HTTP hook execution (hooks could trigger side effects via other channels).
9. Annotations are recorded in `hook-annotations.jsonl` for `after_acceptance` phase, same as process hooks.
10. Audit entries are recorded in `hook-audit.jsonl` with `transport: "http"` field added.

---

## Error Cases

1. `url` missing or not a valid HTTP(S) URL → config validation error.
2. `method` not `"POST"` → config validation error.
3. Header interpolation references undefined env var → config validation error.
4. HTTP timeout → fail-closed on blocking phases, warn on advisory.
5. Non-2xx response → fail-closed on blocking phases, warn on advisory.
6. Response body is not valid verdict JSON → fail-closed on blocking phases, warn on advisory.
7. TLS/network error → same treatment as non-2xx.

---

## Execution Model

HTTP hooks use Node.js synchronous HTTP via `child_process.execFileSync` calling `node -e` with a self-contained fetch script. This preserves the synchronous `runHooks()` contract without introducing async into the hook runner.

Rationale: The hook runner is called synchronously from step.js, resume.js, and other CLI commands. Making it async would require changes across the entire CLI command surface. A contained sync bridge using a child process that performs the HTTP call is the correct isolation boundary.

---

## Acceptance Tests

1. `AT-V21-004a`: Blocking HTTP hook returns `{"verdict":"block"}` → command fails closed, run state coherent.
2. `AT-V21-004b`: HTTP hook timeout on blocking phase → command fails closed.
3. `AT-V21-004c`: Advisory HTTP hook returns block → downgraded to warn.
4. `AT-V21-004d`: HTTP hook with env-backed auth headers → header value resolved from env, not literal `${...}` sent.
5. `AT-V21-004e`: HTTP hook with non-2xx response → treated as failure.
6. `AT-V21-004f`: HTTP hook annotations recorded in `hook-annotations.jsonl` for `after_acceptance`.

---

## Open Questions

1. Should `url` validation enforce HTTPS-only in production configs, or allow HTTP for local development?
   - **Decision:** Allow both HTTP and HTTPS. Operators are responsible for their own transport security. The protocol does not enforce TLS policy.

---

## Decisions

- `DEC-HTTP-HOOK-001`: HTTP hooks use `node -e` sync bridge, not async in the hook runner.
- `DEC-HTTP-HOOK-002`: Header interpolation uses `${VAR}` syntax resolved from hook env + process.env.
- `DEC-HTTP-HOOK-003`: Only POST method is supported in v2.1. GET/PUT/PATCH are deferred.
- `DEC-HTTP-HOOK-004`: HTTP and HTTPS URLs are both allowed. No enforced TLS policy.
