## Purpose

Add a fast, truthful adoption page that gets a new operator from install to their first accepted governed turn in about five minutes.

This page must use the default manual-first `generic` scaffold so the walkthrough requires no API keys and no local coding CLI.

## Interface

- New docs page: `website-v2/docs/five-minute-tutorial.mdx`
- Sidebar placement: between `getting-started` and `first-turn`
- Cross-links from the front-door docs:
  - `website-v2/docs/quickstart.mdx`
  - `website-v2/docs/getting-started.mdx`
- Discoverability update:
  - `website-v2/static/llms.txt`
- Guard test:
  - `cli/test/five-minute-tutorial-content.test.js`

## Behavior

- The page must be explicitly scoped to:
  - install
  - scaffold
  - validate readiness
  - start the first manual turn
  - inspect the active turn with `turn show --artifact assignment --json`
  - write real planning artifacts
  - stage a valid `turn-result.json` using the real `run_id` / `turn_id`
  - accept the turn with `agentxchain accept-turn`
- The page must state the honest product boundary:
  - it uses the default `generic` manual-first template
  - it stops after the first accepted PM turn
  - it does not claim full completion or automated execution
- The page must explain why `Ctrl+C` after `agentxchain step` is legitimate:
  - the turn remains active
  - the operator is switching from the waiting loop to the explicit inspect/stage/accept path
- The page must keep inspection scratch files outside the governed repo so `accept-turn` does not reject the PM result for review-only product-file modifications
- The page must point operators to the longer follow-up surfaces:
  - `getting-started`
  - `first-turn`
  - `tutorial`
- The page must include a short evidence-surface follow-up:
  - `audit` for the live current repo/workspace summary
  - `export` plus `report --input` for a portable artifact and derived summary
  - partial coordinator artifacts stay readable with `repo_ok_count` / `repo_error_count`, failed repo row + error, and no fabricated failed-child drill-down

## Error Cases

- Do not teach a mixed-mode template (`cli-tool`, `web-app`, etc.) on this page.
- Do not require operators to manually copy opaque IDs from terminal output when the CLI can expose them via `turn show --artifact assignment --json`.
- Do not tell operators to write scratch inspection files into the repo; that creates review-only diff noise and can block `accept-turn`.
- Do not claim the walkthrough is zero-config if it silently depends on `ANTHROPIC_API_KEY` or a local coding CLI.
- Do not let the page exist without front-door links; otherwise it becomes another hidden docs node.

## Acceptance Tests

- `website-v2/docs/five-minute-tutorial.mdx` exists and is wired into the sidebar between `getting-started` and `first-turn`
- The page explicitly names `generic` as the manual-first baseline and says no API keys / local coding CLI are required
- The page includes the command chain:
  - `npm install -g agentxchain`
  - `agentxchain init --governed --goal`
  - `agentxchain template validate`
  - `agentxchain doctor`
  - `agentxchain step`
  - `agentxchain turn show --artifact assignment --json`
  - `agentxchain accept-turn`
- `quickstart.mdx` and `getting-started.mdx` link to the new page
- `website-v2/static/llms.txt` includes `/docs/five-minute-tutorial`
- The page teaches `audit` vs `export` vs `report --input` truthfully and keeps the partial coordinator boundary visible

## Open Questions

- None. This is a docs/adoption slice, not a protocol change.
