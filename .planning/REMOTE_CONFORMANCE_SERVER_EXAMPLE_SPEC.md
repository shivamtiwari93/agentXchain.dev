# Remote Conformance Server Example Spec

> Runnable proof slice for remote protocol verification adoption. This example must prove the documented HTTP contract with executable repo-native evidence, not an inline docs snippet that can drift.

Depends on: [REMOTE_PROTOCOL_VERIFICATION_SPEC.md](./REMOTE_PROTOCOL_VERIFICATION_SPEC.md)

## Purpose

Close the current proof gap in the remote verification docs surface.

The repo already ships:

- remote verification engine support in `verify protocol --remote`
- a docs deep-dive at `/docs/remote-verification`
- test-harness proof around the reference adapter

What it does **not** yet ship is a runnable example server that implementors can start, inspect, and verify against directly. The current inline code block is weak evidence because nobody executes it.

This slice adds:

- a real example under `examples/remote-conformance-server/`
- a contract test that runs the server and verifies Tier 1 remotely
- docs that point to the runnable example instead of pretending the inline snippet is enough

## Interface

### Example Files

The example lives at:

```text
examples/remote-conformance-server/
  package.json
  README.md
  server.js
```

No package publish surface is added. This is a repo example only.

### HTTP Contract

The example must expose exactly the shipped remote verification endpoints:

- `GET /conform/capabilities`
- `POST /conform/execute`

### Runtime Interface

The example must support:

- `node server.js`
- `node server.js --port <port>`
- `PORT=<port> node server.js`

Optional auth gate:

- `CONFORMANCE_TOKEN=<token> node server.js`

When `CONFORMANCE_TOKEN` is set, both endpoints require `Authorization: Bearer <token>`.

## Behavior

### 1. Real Fixture Execution, No Stub Logic

The example must not return canned responses.

It wraps the shipped reference fixture engine from `cli/src/lib/reference-conformance-adapter.js` and returns the real result from `runReferenceFixture(fixture)`.

This keeps the example aligned with the actual conformance corpus and avoids a second implementation of fixture semantics.

### 2. Truthful Capabilities

`GET /conform/capabilities` returns a capabilities document with:

- `adapter.protocol: "http-fixture-v1"`
- no `adapter.command`
- Tier and surface claims that match the shipped reference implementation
- repo version pulled from the real CLI package version instead of a hardcoded drift-prone string

### 3. Repo-Example Scope Only

This example is for implementors and proof. It does not become part of the published npm package and it does not create another runtime subsystem.

### 4. Docs Must Point At The Runnable Example

`website-v2/docs/remote-verification.mdx` must reference the GitHub path for `examples/remote-conformance-server/` and show concrete `verify protocol --remote` commands.

The large inline server snippet should be removed or reduced so the runnable file is the canonical example.

## Error Cases

| Condition | Required behavior |
| --- | --- |
| Request path is not `/conform/capabilities` or `/conform/execute` | Return `404` JSON error |
| Wrong method on a valid endpoint | Return `405` JSON error |
| `CONFORMANCE_TOKEN` is set and auth header is missing or wrong | Return `401` JSON error |
| `POST /conform/execute` body is invalid JSON | Return `400` JSON error |
| Reference fixture execution throws | Return `500` JSON error with `message` |
| Docs still present the example only as inline prose | Docs contract test fails |

## Acceptance Tests

- **AT-RCSE-001**: `examples/remote-conformance-server/server.js` exists and is documented by `README.md`.
- **AT-RCSE-002**: Starting the example and running `agentxchain verify protocol --tier 1 --remote <baseUrl> --format json` succeeds with overall `pass`.
- **AT-RCSE-003**: The example’s capabilities response declares `adapter.protocol: "http-fixture-v1"` and omits `adapter.command`.
- **AT-RCSE-004**: When `CONFORMANCE_TOKEN` is set, unauthenticated requests receive `401` and authenticated verification succeeds.
- **AT-RCSE-005**: `/docs/remote-verification` links to the runnable example and shows concrete remote verification commands.

## Open Questions

1. If a future hosted verifier surface appears, should this example stay reference-only or grow a Docker path as well? Out of scope for this slice.
