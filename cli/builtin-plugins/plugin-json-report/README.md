# @agentxchain/plugin-json-report

Built-in AgentXchain plugin that writes structured lifecycle report artifacts into `.agentxchain/reports/`.

Install by built-in short name (recommended):

```bash
agentxchain plugin install json-report
```

Install from a repo-local path:

```bash
agentxchain plugin install ./plugins/plugin-json-report
```

Optional install-time config:

```bash
agentxchain plugin install ./plugins/plugin-json-report \
  --config '{"report_dir":".agentxchain/custom-reports"}'
```

Live proof command:

```bash
node examples/governed-todo-app/run-json-report-proof.mjs --json
```

Hook phases:

- `after_acceptance`
- `before_gate`
- `on_escalation`

Outputs:

- timestamped JSON file per invocation
- `latest.json`
- `latest-<hook_phase>.json`
- default output path `.agentxchain/reports`
- `report_dir` may override the path, but it must stay inside the governed project root
- `latest.json` reflects the most recent hook invocation
