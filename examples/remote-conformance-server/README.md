# Remote Conformance Server Example

Runnable HTTP example for `agentxchain verify protocol --remote`.

This example is not a fake stub. It wraps the shipped reference fixture engine from [`cli/src/lib/reference-conformance-adapter.js`](https://github.com/shivamtiwari93/agentXchain.dev/blob/main/cli/src/lib/reference-conformance-adapter.js), exposes the exact remote verification endpoints, and gives implementors a concrete server they can inspect and run.

## Endpoints

- `GET /conform/capabilities`
- `POST /conform/execute`

The verifier still owns the fixture corpus. This server receives one full fixture JSON document per request and returns one `{status, message, actual}` result.

## Start the server

```bash
cd examples/remote-conformance-server
node server.js
```

Custom port:

```bash
node server.js --port 9000
PORT=9000 node server.js
```

Optional Bearer auth:

```bash
CONFORMANCE_TOKEN=secret123 node server.js
```

## Verify against it

No auth:

```bash
agentxchain verify protocol --tier 1 --remote http://127.0.0.1:8788 --format json
```

With Bearer auth:

```bash
agentxchain verify protocol --tier 1 --remote http://127.0.0.1:8788 --token secret123 --format json
```

## What this proves

- the remote verifier can fetch `http-fixture-v1` capabilities
- the server can execute the shipped fixture corpus over HTTP
- the published request/response contract is runnable, not just described in docs

## What this does not prove

- third-party implementation correctness
- production auth, rate limiting, or multi-tenant hosting
- any hosted certification surface

Use this as a reference starting point for your own conformance server, then replace `runReferenceFixture()` with your implementation's real fixture materialization and execution.
