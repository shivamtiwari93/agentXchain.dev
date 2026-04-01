# Post-v1 Roadmap — AgentXchain

> Draft priorities for v1.1+ after the governed v1.0.0 release.

---

## Tier 1 — Next Release (v1.1)

### 1.1 Scenario D: Multi-Turn Escalation Dogfood
- **What:** Run a full governed lifecycle where an objection escalates through agent → director → human.
- **Why:** The escalation state machine is implemented and unit-tested but never dogfooded end-to-end.
- **Acceptance:** A real repo dogfood session where a blocking objection is raised, auto-escalated after 2 unresolved turns, and resolved by human override.
- **Depends on:** v1.0.0 released, `ANTHROPIC_API_KEY` available.

### 1.2 Auto-Retry with Backoff for `api_proxy`
- **What:** When `api_proxy` returns a retryable error (rate limit, transient network), automatically retry with exponential backoff before surfacing to the operator.
- **Why:** Currently all `api_proxy` failures immediately block the run and require `agentxchain step` manual recovery. Rate limits are common and self-resolving.
- **Spec needed:** Retry policy (max attempts, base delay, jitter), which error categories are retryable, how retries appear in history.

### 1.3 Preemptive Tokenization
- **What:** Count tokens in the dispatch bundle before sending to `api_proxy`, and truncate or split context if it would exceed the model's context window.
- **Why:** Context overflow is currently detected post-hoc via API error. Preemptive detection avoids wasted API calls and improves operator-facing recovery before the request leaves the machine.
- **Spec needed:** Tokenizer selection (tiktoken vs provider SDK), truncation strategy, which context sections are compressible.

---

## Tier 2 — Medium Term (v1.2–v1.3)

### 2.1 Parallel Agent Turns
- **What:** Allow multiple agents to work concurrently within a single phase (e.g., two devs implementing different modules).
- **Why:** Sequential-only is the correct v1 simplification, but real multi-agent workflows need parallelism.
- **Design questions:**
  - Conflict detection when parallel agents touch the same files
  - Turn ordering in history (logical clock vs wall clock)
  - State model: `current_turn` becomes `current_turns[]`?
  - Merge strategy: orchestrator-mediated or agent-mediated
- **Deferred since:** Turn 1, explicitly out of v1 scope.

### 2.2 Provider-Specific Error Code Mapping
- **What:** Map Anthropic/OpenAI error response bodies to typed error codes beyond the current HTTP-status heuristic.
- **Why:** The current classifier is already good enough for v1 recovery. Provider-native codes improve precision, but they are a refinement after the larger reliability wins land.
- **Spec needed:** Error taxonomy per provider, mapping table, adapter extension point.

### 2.3 Persistent Blocked Sub-State
- **What:** Promote `blocked` from a derived state (inferred from `current_turn.status` + recovery descriptors) to a first-class `state.json` status.
- **Why:** Currently, `state.json` shows `active` even when the run is blocked waiting for human recovery. External tools can't distinguish "active and running" from "active but stuck."
- **Open question:** Does this break the state machine invariant that `active` is the only in-progress state?

---

## Tier 3 — Longer Term (v2.0)

### 3.1 Multi-Repo Orchestration
- **What:** A single governed run spans multiple repositories (e.g., frontend + backend + shared types).
- **Why:** Real-world delivery often requires coordinated changes across repos.
- **Complexity:** Workspace isolation, cross-repo artifact references, distributed state.

### 3.2 Persistent Run History / Dashboard
- **What:** A web or TUI dashboard showing run history, decision ledger, and agent performance metrics.
- **Why:** The CLI is sufficient for operators but not for stakeholders who want visibility.

### 3.3 Plugin / Hook System
- **What:** User-defined hooks at protocol events (turn-start, validation-pass, phase-transition, etc.).
- **Why:** Enables custom integrations (Slack notifications, Jira updates, custom validators) without modifying the core protocol.

---

## Deferred Open Questions (Carry-Forward)

These were identified during v1 development and explicitly deferred:

1. Should `approve-transition` and `approve-completion` be idempotent? (P2 HUMAN_TASK)
2. Should `run_completion_request` be raisable by any role or only by the last assigned agent?
3. Should the decision ledger support amendment (correcting a past decision) or only append?
4. What is the right retention policy for `history.jsonl` in long-running projects?
5. Should adapters be pluggable (user-provided adapter classes) or only the three built-in ones?
