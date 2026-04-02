# @agentxchain/plugin-json-report

Built-in AgentXchain plugin that writes structured lifecycle report artifacts into `.agentxchain/reports/`.

Install from this repo:

```bash
agentxchain plugin install ./plugins/plugin-json-report
```

Hook phases:

- `after_acceptance`
- `before_gate`
- `on_escalation`

Outputs:

- timestamped JSON file per invocation
- `latest.json`
- `latest-<hook_phase>.json`
