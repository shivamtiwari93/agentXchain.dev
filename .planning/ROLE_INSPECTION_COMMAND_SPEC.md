# Spec: `agentxchain role` Operator Inspection Surface

## Purpose

Provide a dedicated operator-facing command for inspecting role definitions in governed repos. Operators currently must use `config --get roles` (raw JSON) or read `status` output (abbreviated one-liner) to understand their role configuration. A dedicated `role` command provides structured, human-readable role inspection without raw config parsing.

## Interface

### `agentxchain role list`

Lists all defined roles with title, write authority, and runtime.

**Flags:**
- `--json` — output as JSON array

**Output (text):**
```
Roles (4):

  pm — Product Manager [review_only] → manual-pm
  dev — Developer [authoritative] → local-dev
  qa — QA [review_only] → api-qa
  eng_director — Engineering Director [review_only] → manual-director
```

**Output (JSON):**
```json
[
  { "id": "pm", "title": "Product Manager", "mandate": "...", "write_authority": "review_only", "runtime": "manual-pm" },
  ...
]
```

### `agentxchain role show <role_id>`

Shows detailed information for a single role.

**Flags:**
- `--json` — output as JSON object

**Output (text):**
```
Role: dev

  Title:      Developer
  Mandate:    Implement approved work safely and verify behavior.
  Authority:  authoritative
  Runtime:    local-dev
```

**Output (JSON):**
```json
{ "id": "dev", "title": "Developer", "mandate": "...", "write_authority": "authoritative", "runtime": "local-dev" }
```

## Behavior

1. Both subcommands require a governed repo (v4+ config). Fail with clear error on legacy/ungoverned repos.
2. `role show <unknown_id>` exits 1 with `Unknown role: <id>. Available: pm, dev, qa, eng_director`.
3. `role list` with no roles defined shows `No roles defined.` and exits 0.
4. No mutations. This is read-only inspection.

## Error Cases

- Ungoverned repo → `Not a governed AgentXchain project.`
- Unknown role ID → exit 1 with available roles listed
- Invalid config → validation errors from existing `loadGovernedConfig`

## Acceptance Tests

1. `role list` shows all roles with title, authority, runtime
2. `role list --json` returns valid JSON array with correct fields
3. `role show <id>` shows detailed role information
4. `role show <id> --json` returns valid JSON object
5. `role show <unknown>` exits 1 with helpful error
6. Both commands fail on ungoverned repos

## Open Questions

None.
