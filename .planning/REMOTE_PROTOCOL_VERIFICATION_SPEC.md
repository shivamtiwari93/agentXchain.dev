# Remote Protocol Verification — Slice 1 Spec

> Extends `agentxchain verify protocol` to verify implementations that are not on the local filesystem.

---

## Purpose

Today `verify protocol` only works against a local `targetRoot` directory containing `.agentxchain-conformance/capabilities.json` and a locally-spawnable adapter command. This is fine for first-party development but blocks ecosystem adoption: a third-party implementation running as an HTTP service, a CI-published conformance bundle, or a developer who wants to verify a remote teammate's implementation cannot use the verifier without cloning the entire repo locally.

Slice 1 adds **one** new target form: an HTTP conformance endpoint. The verifier sends fixtures over HTTP and receives the same `{status, message, actual}` responses it currently gets from stdio. The fixture corpus, validation logic, and report format remain identical. Only the transport changes.

---

## Non-Goals (Slice 1)

1. **Auth complexity** — Slice 1 supports a single optional Bearer token. No OAuth, mTLS, or credential management.
2. **Hosted certification** — No `.ai`-hosted verification service. The verifier still runs locally as a CLI command.
3. **Background / async sessions** — Fixtures execute synchronously over HTTP. No polling, no webhooks.
4. **Remote fixture hosting** — The fixture corpus is always local (shipped with the CLI). Only the adapter execution is remote.
5. **New adapter protocol versions** — `stdio-fixture-v1` remains unchanged and supported. We add `http-fixture-v1` alongside it, not replacing it.
6. **Batch execution** — Each fixture is one HTTP request. Batching is a future optimization.
7. **Signed reports or attestation** — Report format is unchanged; no cryptographic proof of remote execution.

---

## Architecture

```
LOCAL (verifier)                          REMOTE (implementation under test)
┌──────────────────────┐                  ┌──────────────────────────────┐
│ agentxchain verify   │                  │ HTTP Conformance Endpoint    │
│ protocol             │                  │                              │
│                      │  GET /conform/   │  ┌────────────────────────┐  │
│ 1. Fetch remote      │──capabilities───▶│  │ capabilities.json      │  │
│    capabilities      │◀────────────────│  │ (same schema)          │  │
│                      │                  │  └────────────────────────┘  │
│ 2. Select fixtures   │                  │                              │
│    (local corpus)    │                  │                              │
│                      │  POST /conform/  │  ┌────────────────────────┐  │
│ 3. Execute each      │──execute────────▶│  │ Adapter logic          │  │
│    fixture via HTTP  │◀────────────────│  │ (materializes setup,   │  │
│                      │  {status,msg,   ││  │  runs operation,       │  │
│ 4. Collect results   │   actual}        │  │  returns result)       │  │
│    into report       │                  │  └────────────────────────┘  │
│                      │                  │                              │
│ 5. Same report       │                  │                              │
│    format as stdio   │                  │                              │
└──────────────────────┘                  └──────────────────────────────┘
```

The remote endpoint is responsible for:
- Serving its `capabilities.json` at `GET /conform/capabilities`
- Accepting fixture JSON at `POST /conform/execute`, materializing the setup, running the operation, and returning the result
- Cleaning up any temporary state between fixtures

The local verifier is responsible for:
- Owning the fixture corpus (fixtures never leave the verifier except as POST bodies)
- All validation, tier filtering, surface enforcement, and report generation
- Timeout and error handling for network failures

---

## Interface

### CLI Surface

```bash
# Existing (unchanged):
agentxchain verify protocol [targetRoot] [--tier N] [--surface S] [--json]

# New:
agentxchain verify protocol --remote <base-url> [--tier N] [--surface S] [--json] [--token <bearer-token>] [--timeout <ms>]
```

**New flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--remote <url>` | string | — | Base URL of the HTTP conformance endpoint. Mutually exclusive with positional `targetRoot`. |
| `--token <token>` | string | — | Bearer token sent as `Authorization: Bearer <token>`. Optional. |
| `--timeout <ms>` | number | 30000 | Per-fixture HTTP timeout in milliseconds. |

**Mutual exclusion:** `--remote` and positional `targetRoot` cannot both be specified. If neither is specified, `targetRoot` defaults to `.` (current behavior).

### Library Surface

```javascript
// Existing signature (unchanged):
verifyProtocolConformance({ targetRoot, requestedTier, surface, fixtureRoot })

// New signature (additive):
verifyProtocolConformance({
  // Local mode (existing):
  targetRoot,       // string — local path. Mutually exclusive with `remote`.

  // Remote mode (new):
  remote,           // string — base URL. Mutually exclusive with `targetRoot`.
  token,            // string | undefined — Bearer token for remote.
  timeout,          // number | undefined — per-fixture timeout ms. Default 30000.

  // Shared:
  requestedTier,    // number — 1, 2, or 3. Default 1.
  surface,          // string | null — surface filter.
  fixtureRoot,      // string — fixture corpus path. Default: bundled fixtures.
})
```

Exactly one of `targetRoot` or `remote` must be provided. Providing both or neither is an error.

---

## Behavior

### 1. Capabilities Loading (Remote)

When `--remote` is specified:

1. `GET <base-url>/conform/capabilities`
2. Expect `200 OK` with `Content-Type: application/json`
3. Parse response body as capabilities JSON
4. Validate with the **same** schema as local `capabilities.json`, with one change:
   - `adapter.protocol` must be `"http-fixture-v1"` (not `"stdio-fixture-v1"`)
   - `adapter.command` is **not required** (it is meaningless for HTTP transport)
   - Instead, `adapter.endpoint` is **optional** — if present, it overrides the base URL for fixture execution. If absent, `<base-url>/conform/execute` is used.

**Remote capabilities.json example:**
```json
{
  "implementation": "acme-orchestrator",
  "version": "1.0.0",
  "protocol_version": "v6",
  "adapter": {
    "protocol": "http-fixture-v1"
  },
  "tiers": [1],
  "surfaces": {
    "state_machine": true,
    "turn_result_validation": true,
    "gate_semantics": true,
    "decision_ledger": true,
    "history": true,
    "config_schema": true
  }
}
```

### 2. Fixture Execution (Remote)

For each selected fixture:

1. `POST <execute-url>` (default: `<base-url>/conform/execute`)
2. Headers:
   - `Content-Type: application/json`
   - `Authorization: Bearer <token>` (if `--token` provided)
3. Body: the raw fixture JSON (same object the stdio adapter receives on stdin)
4. Expect: `200 OK` with JSON body matching the adapter response contract:
   ```json
   {
     "status": "pass" | "fail" | "error" | "not_implemented",
     "message": "optional string",
     "actual": { ... } | null
   }
   ```
5. HTTP status code semantics:
   - `200` — adapter executed and returned a result (check `status` field)
   - `4xx` — treated as fixture `error` with message from response body
   - `5xx` — treated as fixture `error` with message from response body
   - Timeout — treated as fixture `error` with message `"HTTP timeout after <ms>ms"`
   - Network error — treated as fixture `error` with message `"Network error: <details>"`

### 3. Report Generation

The report is **identical** to the current format. The only addition:

```json
{
  "report": {
    "implementation": "acme-orchestrator",
    "protocol_version": "v6",
    "tier_requested": 1,
    "timestamp": "...",
    "target_root": null,
    "remote": "https://acme.example.com/agentxchain",
    "fixture_root": "...",
    "results": { ... },
    "overall": "pass"
  }
}
```

- `target_root` is `null` when in remote mode.
- `remote` is the base URL (new field, `null` in local mode).

### 4. Fixture Corpus Ownership

Fixtures are **always local**. The verifier ships with the canonical fixture corpus. The remote endpoint does not need to host or know about fixtures in advance — it receives the full fixture object in each POST body and must execute it.

This is a critical design choice: the verifier owns truth. The implementation under test cannot cherry-pick which fixtures it sees.

---

## Error Cases

| Condition | Behavior |
|-----------|----------|
| Both `targetRoot` and `--remote` specified | Exit 2, error: "Cannot specify both targetRoot and --remote" |
| Neither `targetRoot` nor `--remote` specified | Default to `targetRoot: "."` (existing behavior) |
| `GET /conform/capabilities` returns non-200 | Exit 2, error: "Failed to fetch remote capabilities: HTTP <status>" |
| `GET /conform/capabilities` returns invalid JSON | Exit 2, error: "Invalid capabilities response: <parse error>" |
| Capabilities missing required fields | Exit 2, error: same validation as local mode |
| Remote capabilities has `adapter.protocol` != `"http-fixture-v1"` | Exit 2, error: "Remote target must declare adapter.protocol 'http-fixture-v1'" |
| `POST /conform/execute` network error | Fixture result: `error`, message includes network details |
| `POST /conform/execute` timeout | Fixture result: `error`, message: "HTTP timeout after <ms>ms" |
| `POST /conform/execute` returns non-JSON | Fixture result: `error`, message: "Malformed response: <details>" |
| `POST /conform/execute` response missing `status` | Fixture result: `error`, message: "Missing status in adapter response" |
| Bearer token provided without `--remote` | Warning printed, token ignored (local mode has no use for it) |

---

## Implementation Plan

### Files to modify:

1. **`cli/src/lib/protocol-conformance.js`** — Core changes:
   - Extract `loadCapabilities()` into `loadLocalCapabilities()` and `loadRemoteCapabilities(baseUrl, token, timeout)`
   - Extract `executeFixture()` into `executeLocalFixture()` and `executeRemoteFixture(executeUrl, token, timeout, fixture)`
   - `verifyProtocolConformance()` becomes `async` and dispatches to local or remote paths based on options
   - `executeRemoteFixture` uses `fetch()` (Node 18+ built-in) with `AbortSignal.timeout()`

2. **`cli/src/commands/verify.js`** — Add `--remote`, `--token`, `--timeout` flags. Validate mutual exclusion.

3. **`cli/test/protocol-conformance-remote.test.js`** — New test file:
   - Mock HTTP server (Node `http.createServer`) serving capabilities and fixture execution
   - Tests for all error cases above
   - Test that fixture results match local execution for the same adapter logic

4. **`.agentxchain-conformance/reference-http-adapter/`** — Reference implementation:
   - Simple Node HTTP server that reads the same `reference-adapter.js` logic
   - Serves `GET /conform/capabilities` and `POST /conform/execute`
   - Used for self-verification: `agentxchain verify protocol --remote http://localhost:PORT`

### Files NOT modified:

- Fixture corpus — unchanged
- Report validation — unchanged (additive `remote` field only)
- `stdio-fixture-v1` path — zero changes to existing local execution

---

## Acceptance Tests

### AT-1: Remote capabilities fetch
```
GIVEN a running HTTP conformance endpoint at <url>
WHEN `agentxchain verify protocol --remote <url> --tier 1 --json`
THEN the verifier fetches GET <url>/conform/capabilities
AND parses the response as capabilities.json
AND proceeds to fixture execution
```

### AT-2: Remote fixture execution produces identical results to local
```
GIVEN the reference adapter running as both:
  (a) local stdio adapter at targetRoot
  (b) HTTP server wrapping the same logic at <url>
WHEN verify protocol runs against (a) and (b) with --tier 1
THEN both reports have the same overall status
AND the same pass/fail/error/not_implemented counts per fixture
```

### AT-3: Mutual exclusion enforced
```
GIVEN both --remote <url> and positional targetRoot are specified
WHEN `agentxchain verify protocol ./path --remote <url>`
THEN exit code 2
AND error message contains "Cannot specify both"
```

### AT-4: Bearer token sent when provided
```
GIVEN a mock HTTP server that rejects requests without Authorization header
WHEN `agentxchain verify protocol --remote <url> --token secret123`
THEN all requests include `Authorization: Bearer secret123`
AND verification proceeds normally
```

### AT-5: HTTP timeout produces fixture error
```
GIVEN a mock HTTP server that delays /conform/execute responses by 5 seconds
WHEN `agentxchain verify protocol --remote <url> --timeout 1000`
THEN timed-out fixtures report status "error"
AND message contains "timeout"
AND the overall report still completes (other fixtures are attempted)
```

### AT-6: Network failure produces fixture error
```
GIVEN --remote points to a URL where no server is listening
WHEN `agentxchain verify protocol --remote http://localhost:1`
THEN capabilities fetch fails
AND exit code is 2
AND error message contains "Network error" or "ECONNREFUSED"
```

### AT-7: Non-200 capabilities response
```
GIVEN a mock HTTP server that returns 404 for GET /conform/capabilities
WHEN `agentxchain verify protocol --remote <url>`
THEN exit code 2
AND error message contains "HTTP 404"
```

### AT-8: Wrong adapter protocol rejected
```
GIVEN a remote capabilities.json with adapter.protocol = "stdio-fixture-v1"
WHEN `agentxchain verify protocol --remote <url>`
THEN exit code 2
AND error message contains "http-fixture-v1"
```

### AT-9: Report includes remote field
```
GIVEN a successful remote verification
WHEN the JSON report is examined
THEN report.remote equals the base URL
AND report.target_root is null
```

### AT-10: Surface enforcement works in remote mode
```
GIVEN a remote capabilities.json with surfaces: { state_machine: true }
WHEN `agentxchain verify protocol --remote <url> --surface gate_semantics`
THEN the verifier rejects with "surface 'gate_semantics' not claimed"
(same behavior as local mode)
```

---

## Open Questions

1. **Should the reference HTTP adapter be a standalone npm script or part of the CLI?** Leaning toward a standalone script in `.agentxchain-conformance/reference-http-adapter/server.js` that imports the reference adapter logic. This keeps it out of the published CLI binary but available for self-test and as a template for implementors.

2. **Should `--remote` accept a capabilities.json URL directly instead of a base URL?** The base-URL convention (`/conform/capabilities`, `/conform/execute`) is simpler and more opinionated. A direct-URL mode adds flexibility but also ambiguity about where to POST fixtures. Leaning toward base-URL only in slice 1.

---

## Decision Record

- `DEC-REMOTE-VERIFY-001`: Slice 1 adds `http-fixture-v1` as a second adapter protocol alongside `stdio-fixture-v1`. Transport changes, fixture corpus and validation logic do not.
- `DEC-REMOTE-VERIFY-002`: The verifier always owns the fixture corpus. Remote endpoints receive fixtures via POST, they do not host or filter them.
- `DEC-REMOTE-VERIFY-003`: Remote capabilities must declare `adapter.protocol: "http-fixture-v1"`. A remote target advertising `stdio-fixture-v1` is rejected — you cannot spawn a subprocess over HTTP.
- `DEC-REMOTE-VERIFY-004`: Auth is limited to optional Bearer token in slice 1. No OAuth, no mTLS, no credential stores.
- `DEC-REMOTE-VERIFY-005`: Each fixture is one HTTP request. No batching in slice 1.
- `DEC-REMOTE-VERIFY-006`: The report format is additive: `remote` field added (null in local mode), `target_root` is null in remote mode.
