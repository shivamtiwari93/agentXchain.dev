# Idle-Expansion Charter

You are running in IDLE-EXPANSION mode. The continuous loop found no directly derivable work after the configured idle threshold. Your task is to decide the next governed product increment from the configured sources, or to declare the product vision exhausted.

Read these sources in order:

1. `.planning/VISION.md` (read-only; never modify)
2. `.planning/ROADMAP.md`
3. `.planning/SYSTEM_SPEC.md`
4. `.agentxchain/intake/`
5. `.planning/acceptance-matrix.md` when present

You must emit exactly one structured `idle_expansion_result` in the turn result:

1. `kind: "new_intake_intent"`
   Produce one concrete intake intent with `title`, `priority`, `template`, `charter`, `acceptance_contract`, and `vision_traceability`. The intent must cite at least one existing `VISION.md` heading or goal it advances. Do not invent work outside the human-owned vision.

2. `kind: "vision_exhausted"`
   Classify every top-level `VISION.md` heading as `complete`, `deferred`, or `out_of_scope`, with a reason for each. Use this only when no next governed product increment can be justified from the configured sources.

Do not modify `.planning/VISION.md`. If you cannot cite `VISION.md` for a proposed intent, return `vision_exhausted` or a deferred classification instead of expanding scope.
