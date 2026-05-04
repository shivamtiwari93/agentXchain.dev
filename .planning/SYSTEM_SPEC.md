# System Spec — M13: Decision Trail Ownership — Vision Closure (VISION.md:34)

**Run:** `run_5b6ee2a8de1bd612`
**Baseline:** git:d36c7185a (latest checkpoint)

## Purpose

This run formally closes the VISION.md:34 goal "nobody owns the decision trail" by verifying that 8 delivered mechanisms across milestones M1, M3, M10, and MW collectively ensure decision trail ownership in multi-agent governed delivery.

"Nobody owns the decision trail" is a governance concern about accountability and auditability — decisions made during agent turns must be persistent, attributed, authority-enforced, and queryable by both agents and operators. Without this, decisions are ephemeral side-effects of code changes rather than owned governance records.

This is distinct from M11's "assumptions diverge" (VISION.md:32), which focused on preventing contradictory decisions via visibility and overlap detection. M13 focuses on the ownership dimension: who decided, with what authority, and how operators and agents can audit the trail.

This is a verification-only run. No new code changes are expected.

## Interface

### Mechanism 1: Decision Ledger with Cross-Run Persistence — `cli/src/lib/repo-decisions.js`

302 lines, 12 exported functions providing full decision CRUD with authority enforcement:

```javascript
readRepoDecisions(repoRoot)                     // Load all decisions from repo-decisions.jsonl
getActiveRepoDecisions(repoRoot)                 // Filter to active (non-overridden) decisions
getRepoDecisionById(repoRoot, id)                // Lookup by DEC-NNN ID
appendRepoDecision(repoRoot, decision)           // Persist new decision with role, authority, timestamp
overrideRepoDecision(repoRoot, id, override)     // Mark decision as overridden with lineage
validateOverride(config, overridingRole, targetDecision)  // Enforce authority rules (line 130)
resolveDecisionAuthority(config, roleName)       // Get role's authority level (0-99, human=100)
renderRepoDecisionsMarkdown(decisions, config)   // Format for agent/operator context
summarizeRepoDecisions(decisions)                // Aggregate stats
getDecisionAuthorityMetadata(config, decision)   // Enrich with authority info
buildRepoDecisionOperatorSummary(repoRoot, config)  // Operator-facing summary
checkOverrideAuthority(config, overridingRole, targetDecision)  // Internal authority check (private)
```

**Storage:** `.agentxchain/repo-decisions.jsonl` — decisions with `durability: "repo"` persist across run boundaries.

**Decision Authority Model:**
- `roles[role].decision_authority` — opt-in integer (0-99) per role in config
- Human defaults to authority 100
- Same-role override always allowed
- Cross-role override requires `overridingAuthority >= targetAuthority`
- Unknown roles treated as authority 0 with warning

**How it ensures ownership:** Decisions are persistent records with explicit role attribution, authority level, timestamp, and override lineage. The authority model ensures decisions can only be changed by roles with sufficient authority — ownership is enforced, not assumed.

### Mechanism 2: Decision History in Dispatch Bundles — `cli/src/lib/dispatch-bundle.js`

Decision visibility to agents at turn time:

- **Line ~1416:** "Decision History" markdown table showing last 50 decisions from the current run
- **Columns:** ID, Phase, Role, Runtime, Statement
- **Line ~775:** Active repo decisions rendered in CONTEXT.md for cross-run constraint visibility
- Rendering via `renderRepoDecisionsMarkdown()` with authority metadata

**How it ensures ownership:** Every agent entering a turn sees the full decision trail. Agents cannot claim ignorance of prior decisions. The trail is proactively delivered, making decision ownership transparent at the point of action.

### Mechanism 3: Coordinator Decision Ledger — `cli/src/lib/governed-state.js`

The framework itself records governance decisions at 5 critical coordination events:

1. **init** — Run initialization decisions (config, template, roles)
2. **dispatch** — Turn dispatch decisions (role selection, charter assignment)
3. **phase-transition** — Gate evaluation and phase advancement decisions
4. **completion** — Run completion and ship decisions
5. **recovery** — Error recovery and retry decisions

Written to `.agentxchain/decision-ledger.jsonl` with full provenance (turn_id, role, phase, category, statement, rationale, durability, status, created_at).

**How it ensures ownership:** The coordination layer itself has an auditable trail. Framework decisions (not just agent decisions) are recorded, ensuring the full governance chain is owned and traceable.

### Mechanism 4: Named Decisions for Multi-Repo Coordination

For cross-repo workstreams:

```javascript
named_decisions: {
  decision_ids_by_repo: {
    api: ["DEC-101"],
    web: ["DEC-201", "DEC-202"]
  }
}
```

- Workstreams declare required decision IDs per repo as completion barriers
- Reports render `required_decision_ids_by_repo` and `satisfied_decision_ids_by_repo`
- `named_decisions` is a barrier type alongside `all_repos_accepted` and `interface_alignment`

**How it ensures ownership:** Decision ownership extends across repository boundaries. Multi-repo deliveries cannot complete unless named decisions are satisfied per repo. Ownership is explicit per-repo, not implicit.

### Mechanism 5: Turn-Result Validator Decision Schema — `cli/src/lib/turn-result-validator.js`

Decision schema enforcement at the protocol boundary:

- **Stage A (Schema):** Validates decision IDs match `DEC-NNN` pattern, categories are from valid enum, statement and rationale are non-empty strings
- **Lines 1293-1377 (Normalization):** Auto-fixes malformed decision IDs, synthesizes missing statements from alternative fields, copies rationale from `reason`/`why`/`description`
- **Stage E (Protocol, line 976):** Challenge requirement — review-only roles MUST raise at least one objection

**How it ensures ownership:** Every turn must explicitly declare decisions with proper attribution. The protocol boundary structurally prevents unowned decisions from entering the system. Malformed decisions are normalized where possible, rejected otherwise.

### Mechanism 6: Scope Overlap Guard — `cli/src/lib/scope-overlap.js`

215 lines, 3 exported functions:

```javascript
extractScopeFingerprint(text)              // Extract milestones, bug refs, file paths, module keywords
computeScopeOverlap(fp1, fp2)              // Jaccard similarity (0.0-1.0)
checkIntentScopeOverlap(intent, activeRun, recentIntents)  // Compare against active work
```

Integrated at `intake.js:901` (approval gate) and `continuous-run.js:1329,1407,1493` (auto-approval sites).

**How it ensures ownership:** Prevents conflicting decision chains from forming. If two runs would produce overlapping decisions, the system defers the second. This ensures decision ownership is unambiguous — a single run owns decisions for a given scope.

### Mechanism 7: No-Edit Review Normalization (BUG-78) — `cli/src/lib/turn-result-validator.js`

Rule 0a (line 1527) normalizes artifact type from `workspace` to `review` for completed turns with empty `files_changed`.

**How it ensures ownership:** Review turns record challenge decisions and objections. If the validation pipeline incorrectly rejected review turns (requiring file changes), the decision audit trail would be corrupted — challenge decisions would fail to record. This normalization ensures the review decision trail remains intact.

### Mechanism 8: Operator Decision CLI — `cli/src/commands/decisions.js`

190-line operator-facing command:

```bash
agentxchain decisions              # List active repo decisions
agentxchain decisions --all        # Include overridden decisions
agentxchain decisions --show DEC-042  # Detailed view with authority metadata
agentxchain decisions --json       # Machine-readable export
```

Shows authority level, binding state (binding/replaced/historical), and override lineage.

**How it ensures ownership:** Operators — the ultimate decision trail owners — have direct query access to inspect, understand, and audit the full decision history at any time. The trail is not locked inside framework internals; it is an operator-facing governance surface.

### Dev Charter

**Verification-only.** Re-run all 8 decision-trail test suites to confirm the decision ownership infrastructure is intact:

```bash
cd cli && npx vitest run test/repo-decisions.test.js                       # 48 tests
cd cli && npx vitest run test/dispatch-bundle-decision-history.test.js     # 12 tests
cd cli && npx vitest run test/coordinator-decision-ledger.test.js          # 7 tests
cd cli && npx vitest run test/named-decisions-visibility.test.js           # 6 tests
cd cli && npx vitest run test/turn-result-validator.test.js                # 100 tests
cd cli && npx vitest run test/scope-overlap.test.js                        # 12 tests
cd cli && npx vitest run test/bug-78-no-edit-review.test.js                # 7 tests
cd cli && npx vitest run test/status-repo-decisions.test.js                # 2 tests
```

Expected: 194 tests, 0 failures. No new code changes expected.

Spot-check key exports:
- `repo-decisions.js`: 12 exports including `appendRepoDecision`, `overrideRepoDecision`, `validateOverride`, `resolveDecisionAuthority`, `getDecisionAuthorityMetadata`
- `decisions.js` command: `--all`, `--show`, `--json` options
- `dispatch-bundle.js`: Decision History table in CONTEXT.md
- `scope-overlap.js`: 3 exports (`extractScopeFingerprint`, `computeScopeOverlap`, `checkIntentScopeOverlap`)

### Architecture Invariants

1. No changes to any mechanism module — verification only
2. Decision ledger uses append-only JSONL — decisions are never silently deleted
3. Decision authority is opt-in per role — null authority means no enforcement
4. Override lineage is immutable — overridden decisions retain their history
5. Operator CLI is read-only — cannot mutate decisions via the command

## Acceptance Tests

All 194 tests across 8 suites must pass:

| # | Suite | Test Count | Mechanism | Status |
|---|-------|-----------|-----------|--------|
| 1 | `repo-decisions.test.js` | 48 | Decision CRUD, authority, override, persistence | Passing (PM verified) |
| 2 | `dispatch-bundle-decision-history.test.js` | 12 | Agent-facing decision history rendering | Passing (PM verified) |
| 3 | `coordinator-decision-ledger.test.js` | 7 | Framework governance event recording | Passing (PM verified) |
| 4 | `named-decisions-visibility.test.js` | 6 | Multi-repo decision coordination | Passing (PM verified) |
| 5 | `turn-result-validator.test.js` | 100 | Decision schema enforcement + challenge | Passing (PM verified) |
| 6 | `scope-overlap.test.js` | 12 | Scope overlap detection + deferral | Passing (PM verified) |
| 7 | `bug-78-no-edit-review.test.js` | 7 | Review turn normalization (audit integrity) | Passing (PM verified) |
| 8 | `status-repo-decisions.test.js` | 2 | Operator status rendering of decisions | Passing (PM verified) |
| | **Total** | **194** | | **All passing** |

### Acceptance Criteria

| # | Criterion | Evidence Required |
|---|-----------|-------------------|
| AC-1 | All 194 decision-trail tests pass | Dev test output showing 194/194, 0 failures |
| AC-2 | `repo-decisions.js` exports 12 decision management functions including authority enforcement | Dev grep/spot-check |
| AC-3 | `decisions` CLI command provides `--all`, `--show`, `--json` operator query access | Dev spot-check |
| AC-4 | Decision authority model enforces hierarchical override (`validateOverride`, `resolveDecisionAuthority`) | Dev grep confirmation |
| AC-5 | Dispatch bundles render decision history for incoming agents | Dev grep of dispatch-bundle.js |
| AC-6 | Coordinator records governance decisions at 5 critical events | Dev confirmation of governed-state.js |
| AC-7 | ROADMAP.md M13 milestone documented with mechanism evidence | PM artifact (this turn) |
| AC-8 | Vision goal "nobody owns the decision trail" addressed by ownership composition | QA assessment of 8-mechanism coverage |
