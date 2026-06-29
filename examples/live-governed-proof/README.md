# Live Governed Proofs

Runnable proof scripts that exercise AgentXchain's governed lifecycle end-to-end through the public CLI. Each script scaffolds a temporary project, drives real governed turns, and asserts on the resulting state, history, and artifacts, then prints a PASS/FAIL summary and exits non-zero on failure.

There are two classes:

- **Deterministic** proofs run without any API key (manual / local fixtures).
- **Model-backed** proofs dispatch to real provider APIs and require credentials — at minimum `ANTHROPIC_API_KEY`; multi-provider proofs may also need `OPENAI_API_KEY` / `GOOGLE_API_KEY`.

## Deterministic (no API key required)

| Script | Proves |
|--------|--------|
| `run-checkpoint-handoff-proof.mjs` | Checkpoint + cross-machine handoff continuity |
| `run-escalation-recovery-proof.mjs` | Escalation and blocked-state recovery |
| `run-coordinator-event-aggregation-proof.mjs` | Multi-repo coordinator event aggregation |
| `run-coordinator-event-surfaces-proof.mjs` | Coordinator event surfaces |
| `run-coordinator-event-websocket-proof.mjs` | Coordinator event WebSocket streaming |
| `run-coordinator-replay-roundtrip-proof.mjs` | Coordinator export → replay round-trip |

## Model-backed (require API keys)

| Script | Proves |
|--------|--------|
| `run-live-turn.mjs` | A single real-model governed turn |
| `run-continuous-3run-proof.mjs` | Continuous lights-out loop across 3 runs |
| `run-continuous-mixed-proof.mjs` | Continuous loop with mixed runtimes |
| `run-multi-provider-proof.mjs` | Governed turns across multiple model providers |
| `run-multi-repo-proof.mjs` | Multi-repo coordinator with real models |
| `run-mcp-real-model-proof.mjs` | `mcp` runtime with real model completions |
| `run-proposed-authority-proof.mjs` | `proposed` write-authority propose → apply flow |

## Run

```bash
cd examples/live-governed-proof

# Deterministic (no key):
node run-checkpoint-handoff-proof.mjs

# Model-backed (set keys first):
export ANTHROPIC_API_KEY=sk-...
node run-live-turn.mjs
```

Captured evidence from prior runs lives in `evidence/`. Several of these proofs back the docs pages under [Examples](https://agentxchain.dev/docs/examples) (e.g. checkpoint-handoff, continuous 3-run).
