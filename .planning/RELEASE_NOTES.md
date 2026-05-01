# Release Notes — agentXchain.dev

## User Impact

**Stricter workspace artifact validation.** Turn results declaring `artifact.type: "workspace"` with empty `files_changed` are now rejected unless the turn declares `verification.produced_files` entries with `disposition: "artifact"`. This prevents no-edit turns from falsely claiming workspace mutations, improving checkpoint integrity.

**Normalization preserves produced-file artifacts.** The workspace→review normalization no longer fires when checkpointable produced files exist, ensuring verification-generated artifacts are properly promoted into the checkpoint.

## Verification Summary

- 99 turn-result-validator unit tests: PASS
- 32 beta-tester scenario tests (BUG-46, BUG-52): PASS
- 79 adjacent validator-exercising tests: PASS
- 4 emission guard tests: PASS
- **Total: 214 tests, 0 failures in scope**

## Upgrade Notes

No breaking changes for conformant turn results. Turn results that previously declared `artifact.type: "workspace"` with empty `files_changed` and no `verification.produced_files` will now fail validation. The fix is to either:
1. Use `artifact.type: "review"` for no-edit turns, or
2. Declare `verification.produced_files` with `disposition: "artifact"` for verification-generated outputs.

## Known Issues

- AGENT-TALK collaboration log guard tests (3/8 fail) are a pre-existing state issue unrelated to this change. TALK.md lacks compressed summary structure from prior runs.
