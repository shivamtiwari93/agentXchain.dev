# Template Blueprint Spec

> Allow governed templates to carry a full scaffold blueprint for roles, runtimes, routing, gates, and workflow-kit so built-in templates can prove non-standard governed teams honestly.

Related specs: [SDLC_TEMPLATE_SYSTEM_SPEC.md](./SDLC_TEMPLATE_SYSTEM_SPEC.md), [TEMPLATE_INIT_IMPL_SPEC.md](./TEMPLATE_INIT_IMPL_SPEC.md), [WORKFLOW_KIT_CONFIG_SPEC.md](./WORKFLOW_KIT_CONFIG_SPEC.md)

---

## Purpose

The current governed template system can change planning artifacts and prompt guidance, but it cannot change the governed team shape. `init --governed` hardcodes:

- roles
- runtimes
- routing
- gates
- prompt file paths
- init output copy

That means a built-in template cannot honestly prove the vision's "chartered roles, not a hardcoded team template" claim. A manifest may now accept `security_reviewer` or `architect` in `prompt_overrides`, but scaffold still emits only `pm`, `dev`, `qa`, and `eng_director`. That is fake proof.

This spec adds an optional manifest field, `scaffold_blueprint`, so a template can replace the default governed team at scaffold time.

The invariant:

- templates without `scaffold_blueprint` keep today's additive scaffold behavior
- templates with `scaffold_blueprint` are allowed to define a different governed team shape at `init` time
- `template set` does **not** rewrite an existing repo's role/routing/gate topology for blueprint-backed templates

## Interface

### Manifest field

```json
{
  "id": "enterprise-app",
  "display_name": "Enterprise App",
  "description": "Governed scaffold for multi-role product delivery with explicit architecture and security-review phases.",
  "version": "1",
  "protocol_compatibility": ["1.0", "1.1"],
  "planning_artifacts": [],
  "prompt_overrides": {},
  "acceptance_hints": [],
  "scaffold_blueprint": {
    "roles": {},
    "runtimes": {},
    "routing": {},
    "gates": {},
    "workflow_kit": {}
  }
}
```

`scaffold_blueprint` is an optional manifest field. When absent, scaffold uses the current default governed team.

When present, it is a partial governed-config payload with these required top-level keys:

- `roles`
- `runtimes`
- `routing`
- `gates`

Optional:

- `workflow_kit`

### Validation contract

Manifest validation must reject any `scaffold_blueprint` that would fail governed config validation once inserted into `agentxchain.json`.

Validation is done by building a minimal governed config shell:

```json
{
  "schema_version": "1.0",
  "project": { "id": "template-manifest", "name": "Template Manifest" },
  "roles": "... blueprint roles ...",
  "runtimes": "... blueprint runtimes ...",
  "routing": "... blueprint routing ...",
  "gates": "... blueprint gates ...",
  "workflow_kit": "... optional blueprint workflow_kit ..."
}
```

and running the existing governed config validator against it.

### Init behavior

If a template has `scaffold_blueprint`, `scaffoldGoverned()` must derive these scaffold-owned surfaces from it:

- `agentxchain.json.roles`
- `agentxchain.json.runtimes`
- `agentxchain.json.routing`
- `agentxchain.json.gates`
- `agentxchain.json.workflow_kit` when provided
- `.agentxchain/prompts/<role>.md` for every role ID in blueprint order
- `.agentxchain/state.json.phase`
- `.agentxchain/state.json.phase_gate_status`
- init terminal output for role and phase summary

Prompt file paths stay deterministic:

```json
{
  "prompts": {
    "<role_id>": ".agentxchain/prompts/<role_id>.md"
  }
}
```

Custom roles use the existing generic governed prompt builder unless a dedicated role-specific builder already exists.

### `template set` boundary

If a template has `scaffold_blueprint`, `agentxchain template set <id>` must fail closed with a clear message:

- this template changes the governed team topology
- use `agentxchain init --governed --template <id>` for new repos
- retrofitting an existing repo to a blueprint-backed team is deferred until a dedicated migrator exists

This is deliberate. Rewriting `roles`, `runtimes`, `routing`, `gates`, prompt files, and workflow-kit inside an existing repo is destructive enough that pretending `template set` can do it safely would be a product lie.

## Behavior

### 1. Backward compatibility

Templates without `scaffold_blueprint` remain byte-for-byte compatible with the current scaffold contract.

### 2. Dynamic scaffold derivation

`init --governed --template <id>` must derive:

- prompt file creation from `Object.entries(config.roles)`
- phase summary from `Object.keys(config.routing)`
- initial run phase from the first routing key
- `phase_gate_status` from every gate referenced by routing

Hardcoded output like `Roles: pm, dev, qa, eng_director` or `Phases: planning → implementation → qa` is only truthful for the default blueprint and must become dynamic.

### 3. Workflow-kit integration

If the blueprint carries `workflow_kit`, init writes it into `agentxchain.json` and uses it when scaffolding custom artifact placeholders. This is the bridge between open-ended roles and per-phase artifact contracts.

### 4. Enterprise proof template

The first blueprint-backed built-in template is `enterprise-app`.

Its purpose is proof, not marketing decoration:

- custom roles beyond `pm/dev/qa`
- custom phases beyond `planning/implementation/qa`
- explicit architecture and security-review artifact contracts
- QA still remains the terminal ship-verdict surface

## Error Cases

| Condition | Required behavior |
|---|---|
| `scaffold_blueprint` fails governed config validation | Manifest load fails with a validation error naming `scaffold_blueprint` |
| Blueprint references a role runtime that does not exist | Manifest load fails |
| Blueprint routing references a missing role or gate | Manifest load fails |
| `template set` targets a blueprint-backed template | Command exits 1 with init-only guidance |
| Init output keeps hardcoded default roles/phases for a blueprint-backed template | Wrong; scaffold summary is lying |

## Acceptance Tests

- `AT-TEMPLATE-BLUEPRINT-001`: manifest validation rejects invalid `scaffold_blueprint` configs.
- `AT-TEMPLATE-BLUEPRINT-002`: `init --governed --template enterprise-app` writes custom roles, runtimes, routing, gates, and workflow_kit into `agentxchain.json`.
- `AT-TEMPLATE-BLUEPRINT-003`: `init --governed --template enterprise-app` creates prompt files for `architect` and `security_reviewer`.
- `AT-TEMPLATE-BLUEPRINT-004`: `init --governed --template enterprise-app` scaffolds workflow-kit artifacts for custom phases.
- `AT-TEMPLATE-BLUEPRINT-005`: init terminal output lists the enterprise-app role set and phase order truthfully.
- `AT-TEMPLATE-BLUEPRINT-006`: `template list --json` exposes blueprint-backed template roles so operators can inspect the custom team shape before scaffolding.
- `AT-TEMPLATE-BLUEPRINT-007`: `template set enterprise-app --yes` fails closed and tells the operator to use `init --governed --template enterprise-app`.

## Open Questions

- Deferred: a future explicit migrator may allow safe blueprint adoption on an existing governed repo, but that is not part of this slice.
