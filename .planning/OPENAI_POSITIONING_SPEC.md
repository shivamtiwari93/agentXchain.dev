# OpenAI Positioning Spec

> Replace the deprecated Swarm comparison target with the current OpenAI Agents SDK in internal positioning artifacts and public-facing comparison language.

---

## Purpose

Keep AgentXchain's OpenAI comparison claims tied to the current official OpenAI surface.

The repo currently has one public positioning sentence that still names `OpenAI Swarm`, even though Swarm is deprecated in favor of the OpenAI Agents SDK. That is exactly the kind of stale ecosystem claim that makes the rest of the launch surface less credible.

This spec defines the minimum correction:

- the internal competitive matrix compares against the OpenAI Agents SDK, not Swarm
- public launch-facing copy does not present Swarm as a live comparison target
- the comparison stays honest about what the Agents SDK does provide today

## Interface

Artifacts in scope:

- `.planning/COMPETITIVE_POSITIONING_MATRIX.md`
- `README.md`
- `cli/test/openai-positioning-content.test.js`

Source requirements:

- OpenAI comparison claims must be backed by current official OpenAI docs or repositories
- Swarm may still appear only as a deprecation/source note, not as a current comparison row or public launch target

## Behavior

### 1. Internal matrix behavior

The competitive matrix must:

- replace the deprecated `OpenAI Swarm` comparison row with `OpenAI Agents SDK`
- describe the Agents SDK in terms supported by official docs:
  - agent orchestration / handoffs / agents-as-tools
  - guardrails
  - human-in-the-loop
  - tracing
  - multi-provider support or adapters where officially documented
- avoid claiming repo-delivery governance features that are not documented

### 2. Public surface behavior

Public launch-facing copy must:

- stop presenting `OpenAI Swarm` as a current comparison target
- use `OpenAI Agents SDK` if an OpenAI adjacent system is named
- keep the claim narrow: AgentXchain governs delivery on a shared codebase; the Agents SDK is an SDK/framework for agent apps

### 3. Verification behavior

Automated content checks must fail if:

- the root README still names `OpenAI Swarm` as a current comparison peer
- public launch-facing surfaces reintroduce `OpenAI Swarm`
- the internal matrix lacks an `OpenAI Agents SDK` row

## Error Cases

- If the matrix compares against Swarm as though it were a current product, the artifact is stale.
- If public README copy mentions Swarm without framing it as deprecated history, the launch surface is stale.
- If the matrix attributes mandatory challenge, phase gates, or append-only delivery ledgers to the Agents SDK without official support, the comparison is overstated.

## Acceptance Tests

1. `.planning/COMPETITIVE_POSITIONING_MATRIX.md` contains an `OpenAI Agents SDK` row and no current-system comparison row for `OpenAI Swarm`.
2. The matrix's OpenAI row documents orchestration/handoffs, human-in-the-loop, tracing, and non-OpenAI provider support only where officially documented.
3. `README.md` names `OpenAI Agents SDK` rather than `OpenAI Swarm` in its adjacent-systems positioning sentence.
4. `cli/test/openai-positioning-content.test.js` fails if `README.md`, `website/index.html`, `website/why.html`, or `.planning/SHOW_HN_DRAFT.md` reintroduce `OpenAI Swarm`.
5. `cli/test/openai-positioning-content.test.js` verifies that the matrix includes the `OpenAI Agents SDK` row and keeps Swarm only as a deprecation/source note.

## Open Questions

1. Should the public website comparison table eventually include the OpenAI Agents SDK, or is the current CrewAI / AG2 / LangGraph table sufficient for launch?
2. If a future launch artifact compares against the Agents SDK directly, should that page also cite the official tracing/HITL docs inline rather than relying on the internal matrix?
