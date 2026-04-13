# Built-In Plugin Docs Spec

> Dedicated public docs for the built-in AgentXchain plugin packages

---

## Purpose

Close the operator gap between "these packages ship in the repo" and "a new user can actually install and use them without reading package source."

The existing `/docs/plugins` page explains the generic plugin system. It does not provide package-specific setup, config, or behavioral boundaries for the three built-in AgentXchain packages:

- `@agentxchain/plugin-slack-notify`
- `@agentxchain/plugin-json-report`
- `@agentxchain/plugin-github-issues`

Each shipped package needs a dedicated public page with truthful setup instructions and non-goals.

---

## Interface

### Routes

- `/docs/plugins/slack-notify`
- `/docs/plugins/json-report`
- `/docs/plugins/github-issues`

### Navigation

- The docs sidebar exposes the three built-in package pages as a first-class `Built-In Plugins` category adjacent to `/docs/plugins`.
- The generic `/docs/plugins` page links to all three dedicated package pages.

### SEO / discoverability

- `website-v2/static/llms.txt` includes all three routes.
- `website-v2/static/sitemap.xml` includes all three routes.

---

## Behavior

### Slack notify page

Must document:

- install path `./plugins/plugin-slack-notify`
- hook phases `after_acceptance`, `before_gate`, `on_escalation`
- webhook URL resolution (`webhook_env` config or default env fallbacks)
- mention prefix behavior (`mention` config or `AGENTXCHAIN_SLACK_MENTION`)
- advisory-only failure semantics

Must not imply:

- blocking behavior
- direct Slack API token usage
- arbitrary post-gate or completion notifications the hook surface cannot prove

### JSON report page

Must document:

- install path `./plugins/plugin-json-report`
- hook phases `after_acceptance`, `before_gate`, `on_escalation`
- default report location `.agentxchain/reports`
- `report_dir` override scoped under the governed project root
- emitted files: timestamped report, `latest.json`, `latest-<hook_phase>.json`

Must not imply:

- uploads to external storage
- writes outside the governed project root

### GitHub issues page

Must document:

- install path `./plugins/plugin-github-issues`
- required config: `repo`, `issue_number`
- optional config: `token_env`, `api_base_url`, `label_prefix`
- one plugin-owned comment per run
- managed phase / blocked labels only
- advisory failure semantics

Must not imply:

- automatic issue close / reopen
- post-gate approval knowledge
- multi-issue routing

---

## Error Cases

1. If a page claims config that the package does not honor, the docs are misleading and the test fails.
2. If the sidebar exposes the generic plugin page but hides the built-in packages, the docs discovery path is insufficient and the test fails.
3. If `llms.txt` or `sitemap.xml` omit the built-in package routes, the discoverability contract is incomplete and the test fails.
4. If the GitHub issues page claims issue closure or approval completion, the test fails because that exceeds the shipped hook evidence.

---

## Acceptance Tests

1. `AT-BUILTIN-PLUGIN-DOCS-001`: all three dedicated built-in plugin docs pages exist.
2. `AT-BUILTIN-PLUGIN-DOCS-002`: `/docs/plugins` links to each dedicated package page.
3. `AT-BUILTIN-PLUGIN-DOCS-003`: sidebar exposes a `Built-In Plugins` category with all three pages.
4. `AT-BUILTIN-PLUGIN-DOCS-004`: Slack docs describe config/env resolution truthfully and preserve the advisory-only boundary.
5. `AT-BUILTIN-PLUGIN-DOCS-005`: JSON report docs describe repo-local `report_dir` behavior and emitted files truthfully.
6. `AT-BUILTIN-PLUGIN-DOCS-006`: GitHub issues docs describe one-comment-per-run, managed-label scope, and non-goals truthfully.
7. `AT-BUILTIN-PLUGIN-DOCS-007`: `llms.txt` and `sitemap.xml` include all three dedicated routes.

---

## Open Questions

1. npm publication of the built-in packages is still deferred. These docs should treat repo-local install as the canonical shipped path until package publication is real.
