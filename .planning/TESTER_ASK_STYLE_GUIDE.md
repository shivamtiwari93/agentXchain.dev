# Tester Ask Style Guide

> Rules for writing copy-paste tester quote-back asks. Extracted from the cross-cutting observation in HUMAN-ROADMAP after V2/V3 surfaced baseline-assumption defects in the tester's real environment.

## Rules

1. **Embed the setup prelude.** Every ask must bundle its own scaffold/setup commands. Do not assume the tester's project has any particular configuration, approval policy, VISION.md content, or intake state. Create a fresh scratch fixture in `/tmp/axc-bug<N>-test` or similar.

2. **Pin the package version.** Use `npx --yes -p agentxchain@<version>` throughout. Never assume the tester has a global install or a particular version.

3. **Use absolute evidence scoping.** Export a `$BUG<N>_START_TS` timestamp before the test command and use it in every `jq` filter to exclude historical events from prior sessions.

4. **Self-contained — no companion runbook.** The ask must be runnable by pasting the commands in order. Do not require the tester to read a separate runbook, follow cross-references, or look up paths.

5. **Distinct blocks with required shapes.** Split evidence into numbered blocks (Block 1 = positive, Block 2 = negative/terminal, Block 3 = summary). Each block states its required shape as bullet points so agents can mechanically verify.

6. **State the rejection rules.** End with a "Review Rules For Agents" section listing the exact conditions under which quote-back should be rejected. This prevents agents from accepting partial or invalid evidence.

7. **State why a separate ask.** Explain why this ask is distinct from companion asks for other bugs. This prevents the tester from merging evidence across asks with different closure contracts.

8. **Git-ignorable state files.** If the ask requires staging `.agentxchain/state.json` or other normally-gitignored files, use `git add -f` explicitly and explain why.

9. **No environmental assumptions.** Do not assume the tester has Claude Max, a specific auth mechanism, or a particular shell. If auth is required, include a preflight check (e.g., `agentxchain --version` to confirm the binary works).

10. **Version-gate the ask.** State the minimum package version and reject evidence from earlier versions. Include a preflight version check command.

## Template

```markdown
# Tester Quote-Back Ask V<N> (BUG-<M>)

Purpose: ...

## Setup Prelude
[Create scratch fixture, install package, seed config/VISION/intents]

## Copy-Paste Message
[Commands to run with $BUG<M>_START_TS scoping]

### Block 1 — positive (describe what this proves)
[Commands + required shape]

### Block 2 — negative/terminal (describe what this proves)
[Commands + required shape]

### Block 3 — SUMMARY
[Aggregation commands + required shape]

## Review Rules For Agents
[Rejection criteria]

## Why A Separate Ask
[Explain distinctness from companion asks]
```

## History

- V1 (BUG-52): assumed `tusq.dev` baseline; worked because BUG-52 was already exercised on a real project.
- V2 (BUG-54/59): assumed `tusq.dev` had `approval_policy` configured + enough derivable work for 10 dispatches. Tester hit two baseline mismatches. Repaired in Turn 8 to create a `/tmp/axc-bug59-54` fixture.
- V3 (BUG-62): assumed bare `agentxchain` binary, working gitignore override, and existing reconcile baseline. Tester hit three copy-paste defects. Repaired in Turn 8 to embed pinned invocations and real baseline establishment.
- V4 (BUG-61): worked correctly on `agentxchain@2.154.11` — tester produced mechanism-verified evidence.
- V5 (BUG-53): self-contained, timestamp-scoped, three-block structure. No baseline defects reported.
- V6 (BUG-60): follows the embed-setup-prelude rule from the start. Creates `/tmp/axc-bug60-test` with seeded VISION, ROADMAP, completed intent, and perpetual-mode config.
