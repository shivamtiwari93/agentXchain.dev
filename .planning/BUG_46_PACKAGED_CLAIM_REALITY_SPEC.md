**Status:** shipped

## Purpose

Freeze the release-gate proof that BUG-46 is fixed in the npm package that actually ships, not only in the source tree.

BUG-46 already has source-tree beta-tester-scenario coverage. That is necessary but insufficient. The packaged CLI must also survive the exact accept/checkpoint/resume seam, because the release discipline explicitly rejects "works from source, broken when built."

## Interface

- Test surface: `cli/test/claim-reality-preflight.test.js`
- Packaging input: `npm pack --json`
- Packaged production modules imported from the extracted tarball:
  - `package/src/lib/governed-state.js`
  - `package/src/lib/turn-paths.js`
- Packaged CLI entrypoint executed from the extracted tarball:
  - `node package/bin/agentxchain.js accept-turn --turn <turn_id>`
  - `node package/bin/agentxchain.js checkpoint-turn --turn <turn_id>`
  - `node package/bin/agentxchain.js resume --role qa`
  - `node package/bin/agentxchain.js run --continue-from <run_id> --continuous --auto-approve --auto-checkpoint`

## Behavior

1. Release preflight must extract the packed tarball into a temp directory.
2. The packaged modules, not source-tree modules, must initialize a governed repo and assign an authoritative `local_cli` QA turn.
3. The packaged CLI must fail closed on the beta tester's exact bad state:
   - `run_id: "run_c8a4701ce0d4952d"`
   - `turn_id: "turn_e015ce32fdafc9c5"`
   - `artifact.type: "workspace"`
   - `files_changed: []`
   - `verification.machine_evidence` that writes actor-owned repo files
   - no `verification.produced_files`
4. The exact-state packaged rejection must:
   - fail loudly on the workspace/files_changed mismatch
   - leave the packaged baseline detector clean afterward (no replay-only repo dirt stranded)
5. The staged result must also reproduce the BUG-46 repair path:
   - `artifact.type: "workspace"`
   - `files_changed: []`
   - `verification.machine_evidence` that creates repo files
   - `verification.produced_files[].disposition === "artifact"` for those files
6. `accept-turn` from the packaged CLI must succeed and persist the promoted files into accepted history.
7. `checkpoint-turn` from the packaged CLI must checkpoint those promoted files instead of skipping with "no writable files_changed".
8. `resume` from the packaged CLI must proceed without dirty-tree deadlock.
9. The packaged CLI must also survive the continuous operator path that used to expose the same semantic seam:
   - authoritative QA
   - `run --continue-from <run_id> --continuous --auto-approve --auto-checkpoint`
   - no `artifact.type: "workspace" but files_changed is empty`
   - no `no writable files_changed paths to checkpoint`
   - accepted history `files_changed` populated from promoted verification-produced artifact files

## Error Cases

- Tarball does not contain the production modules required by the BUG-46 scenario.
- Packaged CLI accepts the beta tester's exact bad state instead of rejecting it.
- Packaged rejection leaves replay-only actor-owned files behind in the working tree.
- Packaged CLI fails `accept-turn`, `checkpoint-turn`, or `resume`.
- Accepted history from the packaged modules does not promote verification-produced artifact files into `files_changed`.
- `checkpoint-turn` skips because the packaged artifact contract drifted from the source-tree contract.
- Packaged continuous mode reintroduces the old deadlock symptoms even though standalone `accept-turn` / `checkpoint-turn` / `resume` still pass.

## Acceptance Tests

1. `node --test cli/test/claim-reality-preflight.test.js` passes with a packaged BUG-46 smoke that runs the extracted tarball end-to-end.
2. The smoke proves:
   - packaged `accept-turn` rejects the exact tester bad state with the workspace/files_changed mismatch
   - packaged baseline remains clean after that rejection
   - packaged `accept-turn` succeeds
   - packaged history contains promoted verification-produced files
   - packaged `checkpoint-turn` does not emit the "no writable files_changed" skip path
   - packaged `resume` succeeds
   - packaged `run --continue-from ... --continuous` also survives the authoritative-QA path without reintroducing the deadlock symptoms

## Open Questions

1. Should release preflight eventually require one packaged smoke per open beta bug, or keep the packaged smoke set limited to the highest-risk seams?
