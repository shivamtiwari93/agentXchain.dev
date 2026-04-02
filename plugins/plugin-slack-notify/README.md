# @agentxchain/plugin-slack-notify

Built-in AgentXchain plugin that posts advisory lifecycle notifications to a Slack incoming webhook.

Install from this repo:

```bash
agentxchain plugin install ./plugins/plugin-slack-notify
```

Environment:

- `AGENTXCHAIN_SLACK_WEBHOOK_URL` or `SLACK_WEBHOOK_URL`: Slack incoming webhook URL
- `AGENTXCHAIN_SLACK_MENTION` (optional): prefix added to each message

Hook phases:

- `after_acceptance`
- `before_gate`
- `on_escalation`
