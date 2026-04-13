# @agentxchain/plugin-slack-notify

Built-in AgentXchain plugin that posts advisory lifecycle notifications to a Slack incoming webhook.

Install from this repo:

```bash
agentxchain plugin install ./plugins/plugin-slack-notify
```

Optional install-time config:

```bash
agentxchain plugin install ./plugins/plugin-slack-notify \
  --config '{"webhook_env":"MY_SLACK_WEBHOOK_URL","mention":"@ops"}'
```

Runtime inputs:

- `webhook_env` (optional): which env var contains the Slack incoming webhook URL
- `mention` (optional): prefix added to each message
- default webhook lookup is `AGENTXCHAIN_SLACK_WEBHOOK_URL`, then `SLACK_WEBHOOK_URL`
- `AGENTXCHAIN_SLACK_MENTION` remains a runtime fallback when `mention` is not configured

Hook phases:

- `after_acceptance`
- `before_gate`
- `on_escalation`

Failure semantics:

- advisory only
- missing webhook config or delivery failures return `warn`, never `block`
