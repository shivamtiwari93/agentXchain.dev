# Habit Board

A governed consumer SaaS example for AgentXchain.

`habit-board` is a daily habit tracker with streak tracking, a responsive dark-theme UI, and a REST API backed by JSON file persistence. No external dependencies beyond Node.js.

## What This Example Proves

- AgentXchain can govern a consumer web application, not just CLI tools or libraries.
- The governed config uses a **designer-in-the-loop** workflow with explicit `workflow_kit` and a 4-phase delivery model (planning, design, implementation, QA).
- The team shape is meaningfully different from `decision-log-linter`: 4 roles (pm, designer, fullstack_dev, qa) instead of 5, with consumer-specific artifacts (user stories, UX flows, design decisions).
- The example ships real source code, a working HTTP server, a vanilla JS frontend, runnable tests, and governed workflow artifacts.

## Run It

```bash
cd examples/habit-board
npm start
# Open http://localhost:3000
```

## Test It

```bash
npm test        # 29 tests
npm run smoke   # Quick streak computation check
```

## Features

- Create habits with custom name and color
- Mark/unmark habits as done for today
- Current streak and longest streak computed automatically
- 30-day completion history per habit
- Responsive card-based UI (dark theme)
- Zero external dependencies

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/habits` | List all habits with streak data |
| POST | `/api/habits` | Create `{ name, color? }` |
| DELETE | `/api/habits/:id` | Delete a habit |
| POST | `/api/habits/:id/check` | Mark today complete |
| DELETE | `/api/habits/:id/check` | Unmark today |
| GET | `/api/habits/:id/history` | 30-day history |

## Governed Delivery Shape

- **pm** owns user stories and acceptance criteria
- **designer** owns UX flows, design decisions, and accessibility
- **fullstack_dev** implements the full stack
- **qa** validates correctness and issues the ship verdict

The workflow routes through `planning -> design -> implementation -> qa`, with explicit workflow-kit artifacts for user stories, UX flows, design decisions, API contract, acceptance matrix, and ship verdict.

## Key Files

```text
habit-board/
├── agentxchain.json          # Governed config with designer-in-the-loop workflow
├── src/
│   ├── server.js             # HTTP server (static + API)
│   ├── api.js                # REST API routes
│   ├── store.js              # JSON file persistence + streak logic
│   └── public/               # Vanilla HTML/CSS/JS frontend
├── test/                     # 29 tests (store + API + smoke)
├── .planning/                # Governed workflow artifacts
└── .agentxchain/prompts/     # Role-specific prompts
```

## How AgentXchain Governed This Example

The product contract is defined in:

- `.planning/ROADMAP.md` — delivery slices and scope
- `.planning/user-stories.md` — user stories and acceptance criteria
- `.planning/ux-flows.md` — interaction patterns and accessibility
- `.planning/design-decisions.md` — visual language and responsive behavior
- `.planning/API_CONTRACT.md` — endpoints, data model, error responses
- `.planning/acceptance-matrix.md` — pass/fail matrix for all criteria
- `.planning/ship-verdict.md` — QA ship recommendation

The governed config in `agentxchain.json` uses explicit roles, gates, and `workflow_kit` artifacts with a consumer SaaS team shape instead of the default scaffold.
