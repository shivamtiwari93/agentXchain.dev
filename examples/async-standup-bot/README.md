# Async Standup Bot

A governed B2B SaaS example for AgentXchain.

`async-standup-bot` is a small team-status collector that lets operators create teams, add members, collect async standups, preview reminder payloads, and generate a manager-facing daily summary. It runs entirely on Node.js with JSON persistence.

## What This Example Proves

- AgentXchain can govern a B2B workflow with integration and operations phases, not just a consumer UI flow or a CLI release flow.
- The governed config uses explicit `workflow_kit` artifacts for operator jobs, integration contracts, reminder policy, operations runbooks, and data retention.
- The team shape is different from the other examples: 5 roles focused on product, integrations, platform delivery, operations, and QA.
- The product ships real source code, a working browser UI, runnable tests, and operational proof artifacts.

## Run It

```bash
cd examples/async-standup-bot
npm start
# Open http://localhost:3000
```

## Test It

```bash
npm test
npm run smoke
```

## Features

- Create teams with channel, timezone, reminder hour, and retention settings
- Add team members with timezone and optional Slack handle
- Submit one daily async standup per member and update it later if plans change
- Generate a manager summary with blockers and missing check-ins
- Preview reminder messages for missing members
- Prune historical standups using the configured retention policy

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/teams` | List all teams with today’s submission status |
| POST | `/api/teams` | Create a team |
| GET | `/api/teams/:teamId` | Fetch one team with members and submission state |
| POST | `/api/teams/:teamId/members` | Add a team member |
| POST | `/api/teams/:teamId/checkins` | Submit or update one daily standup |
| GET | `/api/teams/:teamId/summary` | Build the daily summary digest |
| GET | `/api/teams/:teamId/reminders` | Preview reminder payloads for missing members |
| POST | `/api/ops/prune-retention` | Delete standups older than a cutoff date |

## Governed Delivery Shape

- **pm** owns operator jobs, product scope, and acceptance criteria
- **integration_lead** owns Slack/reminder contract truth and escalation rules
- **platform_engineer** implements the service and browser UI
- **ops_manager** owns operational procedures and retention policy
- **qa** validates end-to-end behavior and issues the ship verdict

The workflow routes through `planning -> integration -> implementation -> operations -> qa`, with explicit workflow-kit artifacts for B2B operator needs.

## Key Files

```text
async-standup-bot/
├── agentxchain.json
├── src/
│   ├── server.js
│   ├── api.js
│   ├── store.js
│   └── public/
├── test/
├── .planning/
└── .agentxchain/prompts/
```

## How AgentXchain Governed This Example

The product contract is defined in:

- `.planning/ROADMAP.md` — delivery slices and scope
- `.planning/operator-jobs.md` — the operator workflows this tool must support
- `.planning/integration-contract.md` — Slack/reminder payload and failure contract
- `.planning/reminder-policy.md` — reminder cadence, escalation, and quiet-hours rules
- `.planning/API_CONTRACT.md` — request/response contract
- `.planning/operations-runbook.md` — daily operating procedure
- `.planning/data-retention.md` — retention and prune process
- `.planning/acceptance-matrix.md` — pass/fail criteria
- `.planning/ship-verdict.md` — QA recommendation

The governed config in `agentxchain.json` uses explicit roles, routing, gates, and workflow-kit artifacts with a B2B operations-oriented team shape instead of the default scaffold.
