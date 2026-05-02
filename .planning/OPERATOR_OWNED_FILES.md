# Operator-Owned Files

These files are **operator-owned configuration**. No agent (PM, Dev, QA, Eng Director) may modify them under any circumstances. If your work appears to require changes to any of these files, raise a blocking objection and route to `human`.

## Protected Files

| File | Reason |
|------|--------|
| `agentxchain.json` | Runtime configuration, timeouts, watch routes, role definitions, budget — operator-controlled |
| `.planning/VISION.md` | Immutable north star — only a human may change this |
| `.planning/OPERATOR_OWNED_FILES.md` | This file itself — only a human may update the protected list |

## Why This Matters

Agents have `write_authority: "authoritative"` for protocol reasons (local CLI runtimes require filesystem access). This is a **behavioral contract** — the filesystem allows writes, but the protocol forbids them for listed files. Violations will cause the operator to reject turns and waste retry budget.
