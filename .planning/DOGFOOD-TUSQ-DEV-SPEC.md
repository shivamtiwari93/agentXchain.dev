Status: Active — dogfood contract starting 2026-04-24. Human-authored. Agents must follow, not rewrite.

# Dogfood Spec — Drive `tusq.dev` Forward Using agentxchain Full Auto Mode

## Purpose

The agents (Claude Opus 4.6/4.7 + GPT 5.5) take over active development of `tusq.dev` as a live dogfood test case for agentXchain. This replaces the back-and-forth ask → tester → quote-back cycle with a compounding feedback loop:

1. Agents drive `tusq.dev` forward using the shipped `agentxchain` CLI in Full Auto Mode.
2. When the loop hits a gap in agentxchain (spawn failure, missing feature, wrong behavior, fragile command, broken scaffold, any blocker), agents switch to agentXchain.dev, file and fix the gap, ship a new release.
3. Upgrade `tusq.dev`'s local `agentxchain` install to the new version, continue the tusq.dev work from where it stopped.
4. Repeat until `tusq.dev` reaches a meaningful milestone autonomously.

Every gap discovered while building a real product is a higher-signal bug than any synthetic reproduction ever will be. This is the intended end-state of the product — operators point agentxchain at their own codebases and let it run lights-out. The agents running their own product on `tusq.dev` is the purest test of that claim.

## Target Repo

- **Absolute path:** `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev`
- **Current branch (operator main):** `main`
- **Current HEAD at time of spec:** `a6a388e Checkpoint AgentXchain quote-back baseline` (2026-04-22)
- **Has agentxchain scaffold:** `.agentxchain/` + `agentxchain.json` + `.planning/` already present
- **Project VISION:** `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/VISION.md` — read this BEFORE starting. tusq.dev builds a capability compiler for SaaS codebases; `tusq.manifest.json` is the canonical output artifact.
- **Most recent operator milestone:** M16 (`tusq diff` manual implementation, commit `369972f`). Agents begin at M17+.

## Operating Mode — Use the Shipped agentxchain CLI

**This is the hard rule.** Agents do NOT hand-drive `tusq.dev` with direct `git commit` + file edits. Agents drive `tusq.dev` by running `agentxchain` from within the `tusq.dev` directory — the same commands a real operator would run.

Specifically:

```bash
cd "/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev"

# ensure you are on the shipped tarball, not a local checkout
npm uninstall -g agentxchain 2>/dev/null || true
npx --yes -p agentxchain@latest -c 'agentxchain --version'   # expected: 2.155.0 or later

# drive the project in Full Auto Mode
npx --yes -p agentxchain@latest -c \
  'agentxchain run --continuous --vision .planning/VISION.md \
     --max-runs 5 --max-idle-cycles 3 --poll-seconds 5 \
     --triage-approval auto --auto-checkpoint \
     --on-idle perpetual'
```

The `--on-idle perpetual` flag is BUG-60's new behavior — idle-expansion fires when the explicit queue empties, synthesizing the next increment from tusq.dev's VISION + ROADMAP + SYSTEM_SPEC. That is exactly the lights-out behavior this dogfood is designed to stress.

If `agentxchain run` blocks, crashes, produces wrong output, or fails to make forward progress, that IS the gap. Record it and switch to the gap-filing workflow (§5 below).

Manual edits to `tusq.dev` source files by agents are prohibited except during diagnostic reproduction inside `agentXchain.dev/.planning/dogfood-tusq-dev-evidence/` scratch fixtures. The `tusq.dev` work product must be produced by running agentxchain.

## Branch Strategy — Respect the Tester's Working Baseline

**Do not commit or push to `tusq.dev` `main`.** The human operator uses `main` as their working baseline. Agents work on a dedicated branch.

### First-turn branch setup

```bash
cd "/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev"
git fetch origin
git checkout -b agentxchain-dogfood-2026-04 origin/main
# push the branch so the tester can see the work without it leaking into their main
git push -u origin agentxchain-dogfood-2026-04
```

All dogfood-session commits happen on `agentxchain-dogfood-2026-04`. If the session runs long and the branch gets stale relative to the tester's main, agents rebase (or cut a new dated branch) at the start of a new session.

**The tester's `main` is read-only from agents' perspective.** Agents can pull from it, diff against it, reference it for baseline comparison — but never commit or push to it.

## Cross-Repo Gap-Filing Workflow

When agentxchain fails, blocks, or misbehaves while driving tusq.dev, follow this loop:

### Step 1 — Detect and isolate

Capture the failure as it happens:
- agentxchain CLI output (stdout + stderr, full not truncated)
- `.agentxchain/events.jsonl` entries around the failure
- `.agentxchain/state.json` before/after snapshots
- Which `agentxchain` subcommand was running (`run --continuous`, `accept-turn`, `unblock`, etc.)
- Any turn IDs, escalation IDs, run IDs

### Step 2 — Reproduce minimally in agentXchain.dev

Create `/Users/shivamtiwari.highlevel/VS Code/1008apps/agentXchain.ai/agentXchain.dev/.planning/dogfood-tusq-dev-evidence/GAP-<sequential-number>-<short-slug>.md` with:
- What tusq.dev work triggered it
- The minimal reproduction (if possible on a fresh scaffold; otherwise document the exact tusq.dev state)
- Captured evidence from Step 1
- Initial hypothesis on root cause

Do NOT modify tusq.dev's working tree during reproduction. Use a scratch fixture project at `/tmp/axc-dogfood-<gap-id>/` if the reproduction needs a fresh scaffold.

### Step 3 — File as a new BUG in agentXchain.dev HUMAN-ROADMAP

`cd` to `agentXchain.dev`, add a new `- [ ] **BUG-<N+1>: ...**` entry in the priority queue. Use the same discipline as prior BUG entries: scope, evidence citation, fix requirements, acceptance criteria, Rule #13 positive+negative regression test requirement. Reference the GAP evidence file from Step 2.

For architectural gaps, the two-agent research/review gate applies (BUG-59 and BUG-60 precedent). For operational gaps, go straight to slice 1.

### Step 4 — Implement the fix in agentXchain.dev

Follow existing discipline — slice-based implementation, review turns between slices, Rule #13 regression tests, no-release-without-local-gate-pass, no speculative DECs filed before implementation.

### Step 5 — Ship a new release

Use `cli/scripts/release-bump.sh --target-version <next-patch>` + push tag. Let the OIDC publish workflow run. Verify `npm view agentxchain version` returns the new version. Sync Homebrew tap.

### Step 6 — Upgrade and retry in tusq.dev

```bash
cd "/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev"
npx --yes -p agentxchain@latest -c 'agentxchain --version'    # confirm new version
# pick up tusq.dev work where it stopped
```

Retry the exact tusq.dev operation that hit the gap. If it succeeds, close the gap (mark the BUG entry `[x]` with `✅ Closed <date> — dogfood reproduction now passes on agentxchain@<version>`). If it fails again with a different symptom, that is a SECOND gap — file as a separate BUG, repeat.

### Step 7 — Continue

Proceed with the next tusq.dev increment.

## Ground Rules

- **Do NOT modify `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/VISION.md`.** It is human-owned, same rule as agentXchain's VISION.md. If tusq.dev's VISION feels wrong or incomplete, raise it in AGENT-TALK.md for human review — do not edit.
- **Do NOT commit to tusq.dev `main`.** Work only on `agentxchain-dogfood-2026-04` (or a successor dated branch).
- **Do NOT force-push any branch on tusq.dev.**
- **Do NOT delete or rewrite the tester's existing work** (manual `M16` implementation, operator-recovery artifacts, etc.). Treat the tester's commits as immutable baseline context.
- **Do NOT invent tusq.dev features outside its VISION.md.** Agents advance increments that VISION calls for (M17+). Scope creep beyond VISION is out-of-bounds.
- **Do USE the shipped npx-pinned agentxchain CLI** for every tusq.dev action — never hand-edit tusq.dev files as a workaround for an agentxchain gap. That's what the gap-filing workflow is for.
- **Do log every dogfood session** in the Evidence section (§7) and in AGENT-TALK.md with a turn-level summary.

## Evidence Capture

All evidence lives under agentXchain.dev, not tusq.dev (to keep tusq.dev clean for the tester and to centralize dogfood findings).

### Directory structure

```
/Users/shivamtiwari.highlevel/VS Code/1008apps/agentXchain.ai/agentXchain.dev/.planning/dogfood-tusq-dev-evidence/
├── README.md                               # index + latest state summary
├── session-<YYYY-MM-DD>.md                 # per-session narrative log
├── GAP-001-<slug>.md                       # per-gap evidence + repro
├── GAP-002-<slug>.md
├── milestone-<M-id>-summary.md             # per-milestone closure evidence
└── raw/
    ├── events-<date>-<run-id>.jsonl        # raw events.jsonl captures
    ├── state-<date>-before-<scenario>.json # state snapshots
    └── cli-<date>-<cmd>.log                # raw CLI stdout/stderr
```

Each session log includes: what tusq.dev increment was attempted, commands run (verbatim), what succeeded, what failed, which GAPs were filed, which tusq.dev commits landed on the dogfood branch.

### What to capture per gap

- Exact agentxchain CLI invocation that reproduced the gap
- Full CLI output (no truncation, no paraphrasing)
- `.agentxchain/events.jsonl` entries in the failure window (timestamp-bounded)
- `.agentxchain/state.json` pre-failure and at-failure
- `.agentxchain/continuous-session.json` if continuous mode was active
- Turn IDs, escalation IDs, run IDs that participated
- The minimal reproduction recipe (for a fresh scaffold if possible)

## Success Criteria

This roadmap item closes (`[x]`) when all three are true:

1. **3+ tusq.dev milestones advanced autonomously.** At least three concrete VISION-driven increments (starting from M17) land on the `agentxchain-dogfood-2026-04` branch via `agentxchain run` — not hand-driven, not manual-recovery-dominated. Each milestone has a signed-off `milestone-<M-id>-summary.md` in the evidence directory.
2. **All encountered gaps are shipped.** Every GAP file in the evidence directory has either (a) a corresponding `[x]` BUG closure in HUMAN-ROADMAP citing the shipped fix version, or (b) an explicit "out of scope" decision recorded with rationale.
3. **Tester-reviewable artifact.** The `agentxchain-dogfood-2026-04` branch has a diff the human operator can skim (commit messages + milestone summaries) to judge whether agentxchain's full-auto claim holds on a real project.

## Stop Conditions

Agents halt dogfood work and escalate to human when ANY of:

- **Budget cap:** `--per-session-max-usd` tripped during a tusq.dev run (configured default: $10/session — operator may raise via config).
- **Stuck loop:** same gap signature encountered ≥3 times across different fix attempts (systemic issue, not incremental).
- **tusq.dev VISION alignment conflict:** the next increment the agents would advance is not unambiguously supported by tusq.dev VISION.md. Do not improvise direction.
- **Explicit human stop:** human updates HUMAN-ROADMAP with a "PAUSE DOGFOOD" instruction.
- **max_idle_expansions hit without tusq.dev progress:** perpetual mode synthesized N increments, none of which reached acceptance. Recover by reviewing the synthesized increments for quality rather than blindly retrying.

Stop conditions leave the dogfood branch in whatever state it reached. Agents write a session-end summary and await human decision.

## First-Turn Checklist

The agent that picks up this dogfood item does the following on its first turn:

1. Read this spec in full.
2. Read `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/VISION.md` in full.
3. Read `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/ROADMAP.md` and `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/SYSTEM_SPEC.md` (if present) to understand current tusq.dev state and planned increments.
4. Verify npm has `agentxchain@2.155.0` or later; if not, investigate (don't dogfood on stale published packages — the point is to exercise latest shipped).
5. Create the dogfood branch `agentxchain-dogfood-2026-04` (push upstream).
6. Initialize the evidence directory at `.planning/dogfood-tusq-dev-evidence/README.md` with a starter session log.
7. Attempt the first tusq.dev increment via `agentxchain run --continuous --on-idle perpetual ...`.
8. Record everything.

Log the turn in AGENT-TALK.md as usual. Tag the turn with `DOGFOOD-TUSQ-DEV-INIT` so the session start is greppable.

## Non-Goals

- Not attempting to reproduce the tester's prior bug reports as acceptance tests. The gap-discovery mechanism IS the test.
- Not committing any agentxchain product changes directly from within `tusq.dev`. agentxchain changes live only in agentXchain.dev.
- Not unpinning the agentxchain version used on tusq.dev from npm (no `npm link`, no local paths). Published tarball only.
- Not pretending to BE the tester. Agents are the dev team; the tester remains the human reviewer of the dogfood branch when the session winds down.

## Related Artifacts

- `/Users/shivamtiwari.highlevel/VS Code/1008apps/agentXchain.ai/agentXchain.dev/.planning/HUMAN-ROADMAP.md` — points at this spec from the DOGFOOD-TUSQ-DEV top-priority entry.
- `/Users/shivamtiwari.highlevel/VS Code/1008apps/agentXchain.ai/agentXchain.dev/.planning/VISION.md` — agentXchain.dev product VISION (the lights-out promise this dogfood is verifying).
- `/Users/shivamtiwari.highlevel/VS Code/1008apps/agentXchain.ai/agentXchain.dev/.planning/WAYS-OF-WORKING.md` — durable operating discipline (commit rules, release discipline, Rule #13).
- `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/VISION.md` — tusq.dev product VISION.
- `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/ROADMAP.md` — tusq.dev roadmap (milestone list).
- `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev/.planning/SYSTEM_SPEC.md` — tusq.dev architecture/spec.

— human, 2026-04-24
