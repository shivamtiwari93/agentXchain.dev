# Checkpoint Handoff Live Proof Spec

## Purpose

Turn the BUG-23 public proof from a prose claim into a durable evidence surface.

The product already has checkpoint behavior, regression coverage, and a runnable harness. That is not the same as a checked-in public proof artifact. The missing contract is a repo-native evidence file plus docs/test parity so the published BUG-23 claim cannot drift into hand-edited narrative.

## Interface

- Live proof script: `examples/live-governed-proof/run-checkpoint-handoff-proof.mjs`
- Checked-in evidence artifact: `examples/live-governed-proof/evidence/checkpoint-handoff-proof.latest.json`
- Public docs page: `website-v2/docs/examples/checkpoint-handoff-proof.mdx`
- Parent index page: `website-v2/docs/examples/live-governed-proof.mdx`
- Content proof: `cli/test/checkpoint-handoff-proof-content.test.js`

## Behavior

1. The harness must scaffold a temporary governed repo and run the real product surface:
   - `agentxchain run --continuous --auto-checkpoint --vision .planning/VISION.md`
2. The default proof remains self-contained:
   - all writable roles run through `local_cli`
   - the default runtime is the checkpoint-changing mock wrapper around `cli/test-support/mock-agent.mjs`
   - no external credentials are required for the default published proof
3. The harness must verify the checkpoint contract directly from the temp repo:
   - at least one `turn_checkpointed` event exists
   - at least one `checkpoint: <turn_id> (role=<role>, phase=<phase>)` git commit exists
   - no `Authoritative/proposed turns require a clean baseline` error appears
   - no unresolved `checkpoint-turn --turn` reminder appears
   - planning and implementation phases are represented in checkpoint commits
4. The harness must support repo-native evidence capture:
   - `--output <path>` writes the JSON payload to the requested file
   - `--keep-temp` preserves the temp repo for inspection
   - the checked-in payload must sanitize workstation-specific absolute paths
5. The evidence payload must include enough fields to bind docs and tests:
   - runner id
   - recorded timestamp
   - CLI version
   - repo-relative CLI and script paths
   - session id / status / runs completed
   - checkpoint commit count and parsed commit subjects
   - checkpoint event count and event breakdown
   - zero clean-baseline error count
6. The public docs page must publish a dated case study with:
   - proof date
   - CLI version
   - session id
   - checkpoint commit count
   - checkpoint event count
   - phases checkpointed
   - source harness path and exact invocation including `--output`
   - checked-in evidence artifact path
7. The parent live-proof index page must link to the dedicated BUG-23 proof page and name the checked-in evidence artifact.
8. The docs/test contract must read from the checked-in artifact rather than duplicating proof numbers as freehand prose.

## Error Cases

- Publishing BUG-23 proof numbers without a checked-in evidence artifact
- Leaving docs bound to a stale run after the harness or artifact changes
- Checking in workstation-specific absolute paths such as `/Users/...` or `/private/...`
- Claiming auto-checkpoint proof while bypassing the real `run --continuous --auto-checkpoint` command path
- Treating regression tests as a substitute for the public live-proof artifact

## Acceptance Tests

- `AT-CKPT-PROOF-001`: spec names the script, evidence artifact, docs page, parent page, and content test
- `AT-CKPT-PROOF-002`: the harness supports `--output <path>` and `--keep-temp`
- `AT-CKPT-PROOF-003`: the checked-in evidence artifact exists, is valid JSON, and records `runner`, `cli_version`, `cli_path`, and `script_path`
- `AT-CKPT-PROOF-004`: the checked-in evidence records a completed or stopped session with at least one checkpoint commit and one checkpoint event
- `AT-CKPT-PROOF-005`: the checked-in evidence records zero clean-baseline errors and sanitized temp paths
- `AT-CKPT-PROOF-006`: the dedicated docs page names the evidence artifact and matches its proof date, CLI version, session id, checkpoint commit count, and checkpoint event count
- `AT-CKPT-PROOF-007`: the dedicated docs page includes the `--output` invocation and links back to the parent live-proof page
- `AT-CKPT-PROOF-008`: the parent live-proof page links to the dedicated docs page and names the checked-in evidence artifact

## Open Questions

- Whether the remaining script-only proofs beyond checkpoint handoff need the same evidence artifact contract now, or only when they back a public product claim
