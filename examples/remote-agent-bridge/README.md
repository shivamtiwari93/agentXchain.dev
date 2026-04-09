# Remote Agent Bridge — Example

Runnable HTTP server that acts as a `remote_agent` for governed AgentXchain turns.

This example proves the full `remote_agent` lifecycle through the public CLI:

1. **Dev turn** — bridge receives a governed turn envelope, returns proposed changes
2. **Proposal apply** — proposed files are staged and applied to the workspace
3. **QA turn** — bridge receives a review turn, returns a review result with audit artifact

## Quick start

### Run the server standalone

```bash
cd examples/remote-agent-bridge
node server.js
```

The server listens on `http://127.0.0.1:8799/turn` by default.

Custom port:

```bash
node server.js --port 9000
```

Optional Bearer auth:

```bash
BRIDGE_TOKEN=secret123 node server.js
```

### Run the automated proof

The proof script starts its own server, scaffolds a project, and exercises the full lifecycle:

```bash
node run-proof.mjs
```

Expected output ends with:

```
  REMOTE AGENT BRIDGE PROOF — ALL CHECKS PASSED
```

### Configure a project to use the bridge

In your `agentxchain.json`:

```json
{
  "runtimes": {
    "my-remote-dev": {
      "type": "remote_agent",
      "url": "http://127.0.0.1:8799/turn",
      "timeout_ms": 30000,
      "headers": {
        "authorization": "Bearer your-token"
      }
    }
  },
  "roles": {
    "dev": {
      "runtime": "my-remote-dev",
      "write_authority": "proposed"
    }
  }
}
```

Then run:

```bash
agentxchain step --role dev
agentxchain proposal apply <turn_id>
```

## What this proves

- The `remote_agent` adapter dispatches governed turn envelopes over HTTP
- A remote service can return valid turn-result JSON with `proposed_changes`
- The acceptance pipeline stages, validates, and materializes proposals
- `proposal apply` copies proposed files into the workspace
- Review-only turns derive audit artifacts without claiming repo writes
- The full lifecycle works through the public `agentxchain` CLI binary

## What this does not prove

- Real AI model integration (the bridge returns deterministic responses)
- Authoritative writes (v1 remote_agent is restricted to `proposed` and `review_only`)
- Async polling or webhook completion (v1 is synchronous only)
- Production auth, rate limiting, or TLS termination

## Request/response contract

### Request envelope (POST to `/turn`)

```json
{
  "run_id": "run_...",
  "turn_id": "turn_...",
  "role": "dev",
  "phase": "implementation",
  "runtime_id": "remote-dev",
  "dispatch_dir": "/path/to/.agentxchain/dispatch/turns/turn_.../",
  "prompt": "... rendered PROMPT.md ...",
  "context": "... rendered CONTEXT.md ..."
}
```

### Response (turn result)

Must be a valid AgentXchain turn-result JSON. For proposed turns, include `proposed_changes[]`. See the [adapter docs](https://agentxchain.dev/docs/adapters) for the full schema.

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/turn` or `/` | POST | Accept a governed turn envelope, return a turn result |
| `/health` | GET | Health check |
