# Demo Narrative Quality Spec

## Purpose

Upgrade `agentxchain demo` narrative from a toy counter app to a scenario that sells governed delivery. The evaluator should think "I need this" within 60 seconds.

## Problem

The current demo tells a generic coding tutorial story: counter app, input validation, error recovery. None of these surface *why governance matters*. The objections are shallow developer concerns. The governance lessons are abstract rules. An evaluator watching the output thinks "cool, an agent framework" instead of "my AI agents need this."

## Changes

### 1. Project narrative: auth token rotation service

Replace the counter app with a security-sensitive scenario: a service that rotates API auth tokens with key expiry, graceful rollover, and audit logging. This is a scenario where:
- Scope creep is dangerous (PM must constrain)
- Implementation gaps have real consequences (dev must be challenged)
- Ship verdicts carry weight (QA must actually verify)

### 2. Sharper objections that show governance value

| Turn | Current (weak) | New (sharp) |
|------|----------------|-------------|
| PM | "No error recovery strategy defined" | "No rollback plan if new tokens fail validation. Live API keys could be invalidated without recovery path." |
| Dev | "No persistence across restarts" | "Token expiry check uses wall-clock time without monotonic fallback. Clock skew could skip rotation or double-rotate." |
| QA | "No input sanitization beyond type checking" | "No audit entry emitted on rotation failure. Compliance requires traceability for every key lifecycle event." |

### 3. Governance lessons that show consequences, not rules

| Current (abstract) | New (consequence-focused) |
|---|---|
| "Governance requires every role to challenge, not rubber-stamp" | "Without mandatory challenge, the PM's missing rollback plan would have reached implementation unchecked" |
| "No agent can skip this. Only a human approves planning exit." | "This gate stopped 3 AI agents from proceeding until a human confirmed the security scope was correct" |
| "Each role challenges independently" | "The dev caught a clock-skew bug the PM missed. Independent challenge surfaces different failure classes" |
| "QA must challenge — governance enforces this" | "QA found a compliance gap neither PM nor dev raised. Three perspectives > one" |
| "Implementation cannot advance to QA without proof that tests pass" | "Without this gate, untested code could reach QA review — wasting a review turn on code that doesn't run" |

### 4. Summary value prop

Replace the generic governance line with a specific claim:
"This run caught 3 issues that would have shipped undetected without governed challenge"

## Constraints

- Keep ~1 second execution time. No new I/O.
- Keep the same structural contract: 3 turns, 5 decisions, 3 objections, same phase gates.
- Keep JSON mode output unchanged (same field shapes).
- Keep all existing test assertions green — update test expectations to match new strings.

## Acceptance Tests

- AT-DNQ-001: Demo output mentions "token rotation" or "auth" (not "counter")
- AT-DNQ-002: Each objection references a security/reliability/compliance consequence
- AT-DNQ-003: Each governance lesson explains a consequence, not just a rule
- AT-DNQ-004: Summary mentions issues caught by governance
- AT-DNQ-005: Duration stays under 3 seconds
- AT-DNQ-006: JSON output contract unchanged (same fields, same counts)
