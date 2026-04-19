# Authoritative Local CLI Role Proof Spec

## Purpose

Freeze the proof obligation that BUG-46 fixes apply to contract tuples, not role names.

The framework allows arbitrary roles with `write_authority: "authoritative"` on `local_cli`. Once that is valid configuration, acceptance, checkpoint, and resume cannot rely on special-casing `qa`, `dev`, or any other canonical label.

## Interface

- Beta-tester scenario coverage lives in `cli/test/beta-tester-scenarios/bug-46-post-acceptance-deadlock.test.js`
- The proof must include at least one non-canonical role ID using:
  - `write_authority: "authoritative"`
  - `runtime.type: "local_cli"`
  - verification replay with declared `verification.produced_files`

## Behavior

1. A non-canonical authoritative `local_cli` role is treated the same as authoritative QA for BUG-46 acceptance rules.
2. If verification-produced files are declared with `disposition: "ignore"` on a review artifact, acceptance restores them before history persists.
3. `checkpoint-turn` must not strand replay-only workspace dirt for that role.
4. `resume --role <role_id>` must proceed cleanly after acceptance if the replay side effects were correctly classified.
5. Coverage docs may only claim the `role × write_authority × runtime` tuple is covered after this proof exists.

## Error Cases

- Acceptance or cleanup logic depends on role name instead of `write_authority`
  - the non-canonical role scenario fails while QA still passes
- Verification replay leaves actor-owned dirt after acceptance
  - `checkpoint-turn` or `resume` blocks
- Coverage docs mark arbitrary authoritative roles as covered without an explicit scenario
  - the matrix is lying and must be corrected

## Acceptance Tests

1. `bug-46-post-acceptance-deadlock.test.js` includes a non-canonical role (for example `product_marketing`) with `authoritative + local_cli`.
2. That scenario accepts a review artifact with ignored verification-produced files, leaves no actor-owned dirt, checkpoints cleanly, and allows `resume`.
3. The `BUG_31_33_COVERAGE_GAP_POSTMORTEM.md` role matrix points at the explicit scenario instead of “shared contracts only”.

## Open Questions

- Whether the matrix should eventually enumerate one example per template-provided authoritative role, or whether one arbitrary-role proof is sufficient as the minimum contract.
