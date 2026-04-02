# Post-v1 Roadmap — AgentXchain

> Draft priorities after the governed `1.0.0` public release.

---

## Purpose

Keep the roadmap honest about what is already implemented versus what is still upcoming. The repo now contains a substantial in-tree v1.1 feature set; the remaining work for that release is operational hardening, not speculative implementation.

---

## Tier 1 — Release Hardening (v1.1)

### 1.1 Release-Candidate Hygiene

- **What:** Prepare a clean release-candidate workspace, rerun the full CLI suite, and record the baseline that will justify `npm version 1.1.0`.
- **Why:** The open work for v1.1 is no longer feature construction. It is proving that the release artifact is cut from a clean tree with a current baseline.
- **Source of truth:** `.planning/V1_1_RELEASE_CHECKLIST.md`

### 1.2 Publish And Package Handoff

- **What:** Confirm the tag-push publish path, Homebrew follow-up, and release brief for `1.1.0`.
- **Why:** The automation exists. What remains is release-day readiness, not more core protocol code.
- **Source of truth:** `.planning/V1_1_RELEASE_HANDOFF_SPEC.md`, `.planning/RELEASE_CUT_SPEC.md`, `.planning/RELEASE_BRIEF.md`

### 1.3 Scenario D Escalation Dogfood

- **What:** Run the two human-in-the-loop escalation paths that already exist:
  - `D1` retry exhaustion -> blocked recovery -> redispatch of the preserved turn
  - `D2` explicit `eng_director` intervention -> human follow-up
- **Why:** This validates operator ergonomics and evidence quality after release. It does **not** block the v1.1 cut.
- **Spec:** `.planning/SCENARIO_D_ESCALATION_DOGFOOD_SPEC.md`
- **Dependency:** v1.0.0 released, human operator available, optional live `ANTHROPIC_API_KEY`

### Graduated v1.1 Feature Set Already Implemented

These are no longer roadmap candidates. They are already in the workspace and belong to the v1.1 release contract:

- Parallel agent turns
- `api_proxy` auto-retry with backoff
- Preemptive tokenization
- Anthropic-specific provider error mapping
- Persistent blocked state

The checklist question is release proof, not feature existence.

---

## Tier 2 — Next Product Frontier (v2 Architecture)

### 2.1 Multi-Repo Orchestration

- **What:** Govern one initiative across multiple repositories without allowing any single turn to mutate multiple repos.
- **Why:** This is the first real expansion beyond the single-repo safety model and the most important v2 architecture boundary.
- **Spec:** `.planning/MULTI_REPO_ORCHESTRATION_SPEC.md`
- **Next deliverable:** implementation plan with coordinator state transitions, repo registration/bootstrap flow, and failure recovery rules

### 2.2 Cloud Boundary / Managed Control Plane

- **What:** Define the first cloud-facing seam between the open-source orchestrator and a hosted coordination surface.
- **Why:** The business model in `VISION.md` depends on separating protocol/orchestrator concerns from hosted visibility and policy infrastructure.
- **Open question:** whether the first boundary is run-history ingestion, remote dashboard state, or managed adapter execution

### 2.3 SDLC Template System Adoption

- **What:** Finish surfacing the built-in governed templates cleanly across docs and examples after the core command set (`agentxchain init --governed --template <id>`, `agentxchain template list`, `agentxchain template set <id>`) is stable.
- **Why:** Template scaffolds matter, but they are not a higher-order architecture frontier than multi-repo governance.
- **Specs:** `.planning/SDLC_TEMPLATE_SYSTEM_SPEC.md`, `.planning/TEMPLATE_INIT_IMPL_SPEC.md`, `.planning/TEMPLATE_SET_SPEC.md`

---

## Tier 3 — Broader Platform Surface

### 3.1 Dashboard Evolution

- **What:** Build beyond the v2.0 read-only local dashboard toward richer operator evidence and, later, organizational visibility.
- **Why:** The local dashboard is shipped. The next step is deciding which deeper visibility or control surfaces are worth adding without violating the governance model.

### 3.2 Plugin / Hook Expansion

- **What:** Extend the shipped hook system into organization-facing integrations and policy bundles.
- **Why:** The core hook lifecycle exists. The next work is packaging and safely exposing it for real teams.

---

## Deferred Open Questions

1. Which v2 boundary lands first after the v1.1 cut: multi-repo execution or the first cloud-managed control-plane slice?
2. Does template-system documentation stop at command/operator guidance, or is a public `/templates` site surface worth the maintenance burden?
3. When multi-repo orchestration lands, does it ship as coordinator-only planning/spec state first, or with repo-bootstrap commands in the same cut?
