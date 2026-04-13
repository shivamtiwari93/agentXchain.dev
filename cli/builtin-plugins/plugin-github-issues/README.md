# @agentxchain/plugin-github-issues

Built-in AgentXchain plugin that mirrors governed run status into a configured GitHub issue.

Install from this repo:

```bash
agentxchain plugin install ./plugins/plugin-github-issues
```

Hook phases:

- `after_acceptance`
- `on_escalation`

Required config:

- `repo`: GitHub repository in `owner/name` form
- `issue_number`: GitHub issue number

Optional config:

- `token_env`: token environment variable name (default runtime fallback: `GITHUB_TOKEN`)
- `api_base_url`: GitHub API base URL (default runtime fallback: `https://api.github.com`)
- `label_prefix`: managed label prefix (default runtime fallback: `agentxchain`)

Scope notes:

- One plugin-owned comment per run, updated in place
- Managed labels track phase or blocked state only
- This plugin does **not** close issues or claim post-gate approval state because the hook surface does not provide post-gate truth
