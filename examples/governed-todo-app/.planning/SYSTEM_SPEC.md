# System Spec — Governed Todo App

## Purpose

Define the minimum governed todo-app slice so planning can hand off a truthful implementation contract.

## Interface

- `agentxchain.json` governed config
- `.planning/` workflow artifacts
- `index.js` or equivalent application entrypoint

## Behavior

The app should allow the team to plan, implement, and verify a small todo workflow under governed delivery.

## Error Cases

- Missing planning artifacts block phase transition
- Failed verification blocks implementation exit

## Acceptance Tests

- [ ] Planning artifacts are present and truthful
- [ ] Implementation verification passes
- [ ] QA can produce a ship verdict

## Open Questions

- Should the example remain CLI-only or grow a small UI later?
