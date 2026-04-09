# Security Audit — 2026-04-09

## Context

After `v2.32.0` push, GitHub reported 7 open Dependabot alerts (1 critical, 6 medium).

## Findings

### Hono / @hono/node-server (6 alerts — all false positives)

| Alert | Package | Severity | Fixed In | Installed | Status |
|-------|---------|----------|----------|-----------|--------|
| #47 | @hono/node-server serveStatic repeated slashes | medium | 1.19.13 | 1.19.13 | **Already patched** |
| #48 | hono serveStatic repeated slashes | medium | 4.12.12 | 4.12.12 | **Already patched** |
| #49 | hono toSSG() path traversal | medium | 4.12.12 | 4.12.12 | **Already patched** |
| #50 | hono setCookie() name validation | medium | 4.12.12 | 4.12.12 | **Already patched** |
| #51 | hono ipRestriction() IPv4-mapped IPv6 | medium | 4.12.12 | 4.12.12 | **Already patched** |
| #52 | hono getCookie() non-breaking space bypass | medium | 4.12.12 | 4.12.12 | **Already patched** |

**Root cause:** hono and @hono/node-server are transitive dependencies of `@modelcontextprotocol/sdk@1.29.0`. Lock files already resolved to the exact fix versions. GitHub Dependabot lagged behind reality.

**Action:** All 6 dismissed as false positives with explanation.

**Risk assessment:** Even if these were vulnerable, hono is used only inside the MCP SDK for local server transport — not exposed to untrusted traffic in production usage. None of the specific attack vectors (cookie manipulation, IP restriction bypass, SSG path traversal, serveStatic traversal) apply to AgentXchain's usage pattern: the MCP SDK runs a local-only HTTP transport for agent communication.

### Axios (1 alert — real, fixed)

| Alert | Package | Severity | Fixed In | Was Installed | Status |
|-------|---------|----------|----------|---------------|--------|
| #55 | axios NO_PROXY SSRF bypass | critical | 1.15.0 | ^1.13.6 | **Fixed** |

**Location:** `examples/Baby Tracker/baby-tracker/frontend/package.json` — a governed product example, not the core CLI or website.

**Action:** Bumped minimum from `^1.13.6` to `^1.15.0`. Updated workspace lock file. `npm audit` now shows 0 vulnerabilities.

**Risk assessment:** This was a real vulnerability but only in an example project's frontend (React app). It does not affect the agentxchain CLI, the website, or any production surface. The Baby Tracker example is a demonstration artifact — it does not run in production anywhere.

### Core surfaces

- `cli/` — `npm audit`: **0 vulnerabilities**
- `website-v2/` — `npm audit`: **0 vulnerabilities**

## Homebrew mirror drift (bonus fix)

The local Homebrew formula mirror (`cli/homebrew/agentxchain.rb` and `cli/homebrew/README.md`) was still pointing at v2.31.0 while the canonical tap and npm registry had v2.32.0. Updated both to v2.32.0 with correct SHA256. This fixed 2 failing homebrew-mirror-contract tests.

## Decision

`DEC-SECURITY-AUDIT-001`: All 7 open GitHub Dependabot alerts resolved. 6 hono/hono-node-server alerts dismissed as false positives (already on patched versions). 1 axios alert fixed by version bump in example project. Core CLI and website have zero known vulnerabilities.
