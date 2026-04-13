# Governed Doctor — Spec

## Purpose

Replace the legacy `doctor` command's role for governed (v4) projects with a truthful readiness surface. The governed doctor answers one question: **"Can this repo run governed turns with the configured runtimes and workflow?"**

The legacy `doctor` checks `jq`, `osascript`, watch processes, trigger files, and PM signoff — none of which are relevant for governed (v4) projects. This spec defines the governed replacement.

## Interface

### CLI

```
agentxchain doctor [--json]
```

- Default: human-readable table (PASS / WARN / FAIL per check)
- `--json`: machine-readable JSON output with all check results
- Exit code 0: all checks pass or only warnings
- Exit code 1: any check fails

### Behavior by config version

- **v4 (governed) config**: runs the governed readiness checks defined below
- **v3 (legacy) config**: runs the existing legacy doctor checks (no change)
- **No config**: fails with "No agentxchain.json found"

## Governed Readiness Checks

Each check produces `pass`, `warn`, or `fail`.

### 1. Config validation (`config_valid`)

- Load `agentxchain.json` and run `loadNormalizedConfig()`
- **pass**: config loads and validates without errors
- **fail**: config has validation errors (report first 3 errors)

### 2. Roles defined (`roles_defined`)

- Check that at least one role exists in the normalized config
- **pass**: 1+ roles defined
- **fail**: no roles defined

### 3. Runtime binaries reachable (`runtime_reachable`)

One sub-check per runtime defined in config:
- `local_cli`: check `command -v <binary>` for the command's first token
- `api_proxy`: check that the `auth_env` environment variable is set and non-empty
- `mcp` (stdio): check `command -v <command>` for the command's first token
- `mcp` (streamable_http): warn (cannot verify remote endpoints at doctor time)
- `remote_agent`: warn (cannot verify remote endpoints at doctor time)
- `manual`: pass (no binary needed)
- **pass**: all local binaries found / env vars set
- **fail**: any required binary missing or env var unset
- **warn**: remote endpoints cannot be verified

### 4. State directory exists (`state_dir`)

- Check that `.agentxchain/` directory exists
- **pass**: directory exists
- **warn**: directory missing (will be created on first `run` or `step`)

### 5. Governed state health (`state_health`)

- If `.agentxchain/state.json` exists, parse and check `schema_version`
- **pass**: state file exists and parses with recognized schema version
- **fail**: state file exists but is malformed or has unrecognized schema version
- **warn**: state file does not exist (expected before first run)

### 6. Schedule health (`schedule_health`)

- Only checked when `schedules` are configured in `agentxchain.json`
- If no schedules configured: skip (do not display)
- If schedules configured:
  - Read daemon state via `evaluateDaemonStatus()`
  - **pass**: daemon is `running`
  - **warn**: daemon is `stale`, `not_running`, or `never_started`
  - Report daemon status detail in output

### 7. Workflow-kit artifacts (`workflow_kit`)

- If workflow_kit is configured with required artifacts for the current phase:
  - Check that all required artifacts for the initial phase exist on disk
  - **pass**: all present
  - **warn**: some missing (expected before first turn in a new project)
- If no workflow_kit configured: skip

### 8. Plugin health (`plugin_<name>`)

- Only checked when plugins are installed in `rawConfig.plugins`
- Per plugin:
  - install path exists
  - manifest file exists and parses
  - relative hook files declared by the manifest exist
  - env-backed config values warn when their env vars are unset
- **pass**: plugin is structurally intact and any referenced env vars are present
- **warn**: plugin is structurally intact but one or more referenced env vars are missing
- **fail**: install path, manifest, or hook files are missing/corrupt

### 9. Connector handoff metadata

- `doctor` remains a static readiness surface. It does **not** perform live connector probes.
- When configured runtimes include `api_proxy`, `remote_agent`, or MCP `streamable_http`, `doctor --json` reports:
  - `connector_probe_recommended`
  - `connector_probe_runtime_ids`
  - `connector_probe_detail`
- Human-readable output prints a next-step hint to run `agentxchain connector check` only when:
  - no doctor checks failed, and
  - at least one configured runtime still needs a live probe beyond static readiness
- No handoff hint is printed for local-only runtime sets (`manual`, `local_cli`, MCP `stdio`)

## Output Format

### Human-readable (default)

```
  AgentXchain Governed Doctor
  ────────────────────────────────────────────
  Project: my-project (v4)

  PASS  Config validation     Config loads and validates
  PASS  Roles defined         3 roles: pm, dev, qa
  PASS  Runtime: local-dev    claude binary found
  FAIL  Runtime: api-proxy    ANTHROPIC_API_KEY not set
  PASS  State directory       .agentxchain/ exists
  WARN  State health          No state file yet (first run pending)
  PASS  Schedule health       Daemon running (last heartbeat 12s ago)

  Ready with 1 failure, 1 warning.
```

### JSON (`--json`)

```json
{
  "project": "my-project",
  "config_version": 4,
  "overall": "fail",
  "connector_probe_recommended": true,
  "connector_probe_runtime_ids": ["api-main"],
  "connector_probe_detail": "Run `agentxchain connector check` to live-probe api / remote HTTP runtimes before the first governed turn.",
  "checks": [
    {
      "id": "config_valid",
      "name": "Config validation",
      "level": "pass",
      "detail": "Config loads and validates"
    },
    ...
  ],
  "fail_count": 1,
  "warn_count": 1
}
```

## Error Cases

- `agentxchain.json` not found → exit 1, message: "No agentxchain.json found. Run `agentxchain init` first."
- `agentxchain.json` is invalid JSON → config_valid check fails, other checks still run where possible
- Runtime binary not in PATH → runtime_reachable check fails for that runtime
- API key env var unset → runtime_reachable check fails for that runtime
- `.agentxchain/state.json` malformed → state_health check fails
- Schedule daemon stale → schedule_health check warns
- `api_proxy` / `remote_agent` / HTTP MCP runtimes configured → doctor reports connector-probe handoff metadata instead of silently implying live reachability

## Acceptance Tests

- **AT-GD-001**: `agentxchain doctor --json` on a valid governed project returns `overall: "pass"` with all checks passing
- **AT-GD-002**: `agentxchain doctor --json` on a governed project with a missing runtime env var returns `overall: "fail"` with `runtime_reachable` check failing
- **AT-GD-003**: `agentxchain doctor --json` on a governed project before first run returns `state_health` as `warn` (no state file)
- **AT-GD-004**: `agentxchain doctor` (human-readable) on a valid governed project prints PASS/WARN/FAIL badges
- **AT-GD-005**: `agentxchain doctor --json` on a legacy v3 project runs legacy checks, not governed checks
- **AT-GD-006**: `agentxchain doctor --json` on a governed project with schedules configured but no daemon returns `schedule_health` as `warn`
- **AT-GD-007**: `agentxchain doctor` in a directory with no config exits code 1
- **AT-GD-008**: `agentxchain doctor --json` exposes connector-probe recommendation metadata for runtimes that need live probing beyond static readiness
- **AT-GD-009**: text-mode `agentxchain doctor` prints a `connector check` next-step hint when no checks fail and live-probe runtimes are configured
- **AT-GD-010**: local-only runtime sets do not trigger connector-probe recommendation metadata or text hints

## Non-Scope

- Remote endpoint health checks (MCP streamable_http, remote_agent URLs) — these require network calls and are not repo-local truth
- Plugin readiness — the plugin system has its own lifecycle
- Coordinator/multi-repo readiness — the coordinator has its own status surface
- Modifying or upgrading the legacy v3 doctor checks
- Folding live connector probes into `doctor` itself; that behavior remains owned by `agentxchain connector check`

## Decision

- `DEC-GOVERNED-DOCTOR-001`: The governed doctor replaces the legacy doctor's role for v4 projects. Legacy v3 projects continue to use the existing checks. The two paths share the `doctor` command entry point and dispatch based on detected config version.
