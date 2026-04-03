# AgentXchain v2.1.0 Release Notes Draft

Status: draft only. Do not publish until `v2.0.1` is published to npm, merged from `release/v2.0.1` into `main`, and the merged `main` suite is green.

## Release Theme

`v2.1.0` is a trust-hardening and operator-visibility release. It does not add a new orchestration model. It makes governed execution harder to tamper with, easier to integrate with external policy systems, and easier to audit from the dashboard.

## Shipped In v2.1.0

### V2.1-F1 — Dispatch Manifest Integrity

- Finalized dispatch bundles now write `MANIFEST.json` with file digests, byte sizes, and bundle identity.
- Adapters verify the manifest before execution and fail closed on unexpected files, missing files, or digest/size mismatch.
- Dispatch-bundle integrity now covers the real finalization boundary, not the earlier and weaker "files happened to exist" assumption.

### V2.1-F2 — HTTP Hooks And Plugin Hardening

- Hooks now support `"type": "http"` with JSON POST transport, env-backed header interpolation, timeout handling, and the same allow/warn/block verdict contract as process hooks.
- Blocking HTTP hooks fail closed on timeout or explicit `block`.
- Plugin lifecycle is harder to abuse: enforced `config_schema`, first-class upgrade flow, and rollback on failed upgrade.

### V2.1-F3 — Dashboard Evidence Drill-Down

- Timeline cards can expand into turn-detail panels with hook annotations and nearby audit context.
- Decision ledger now supports phase/date filtering and objection visibility.
- Hook audit log now supports phase, verdict, and hook-name filters.
- Dashboard remains read-only. The gain is evidence depth, not new write authority.

## Upgrade And Release Notes

- This draft assumes `release/v2.0.1` is merged back before the `v2.1.0` cut. `v2.0.1` remains the corrective publish-path release and must land first.
- `v2.1.0` stays inside the `.dev` product boundary: governed protocol, runner, connector, plugin, and dashboard work. No `.ai` SaaS/dashboard expansion is implied here.
- Deferred items remain deferred: signed plugin trust policy, Wasm hook isolation, dashboard write actions, and streaming agent output are not part of `v2.1.0`.

## Verification Status

- Current pre-merge `main` verification: `1028 tests / 235 suites / 0 failures`
- Final release proof still requires:
  - successful `release/v2.0.1` publish
  - merge-back to `main`
  - rerun of the full merged `main` suite
  - `release-preflight.sh --target-version 2.1.0`
  - publish workflow postflight against the real `2.1.0` registry artifact

## Source Artifacts

- Scope boundary: `V2_1_SCOPE_BOUNDARY.md`
- Release handoff: `RELEASE_BRIEF.md`
- Normative protocol: `PROTOCOL-v6.md`
- Release delta: `cli/CHANGELOG.md`
