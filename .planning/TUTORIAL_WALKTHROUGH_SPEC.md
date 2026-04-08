# Tutorial Walkthrough Spec

## Purpose

A single narrative page that takes an operator from install to `approve-completion` without stitching together five reference pages. This is the missing "do the whole thing once" path — not a reference doc, not a deep-dive, not a demo rerun.

## Interface

- Docusaurus page at `website-v2/docs/tutorial.mdx`
- Sidebar position: between `first-turn` and `cli` (position 3)
- Linked from `getting-started.mdx` "What to read next" section
- Listed in `sidebars.ts`, `sitemap.xml`, `llms.txt`

## Behavior

The tutorial walks through a **complete governed lifecycle** using only shipped commands:

1. **Install** — `npx agentxchain@latest --version`
2. **Scaffold** — `init --governed --template cli-tool --dir . -y`
3. **Rebind runtimes for a fully manual path** — change `dev` from `local-dev` to `manual-dev`, change `qa` from `api-qa` to `manual-qa`, add `manual-dev`
4. **Planning turn** — `step` (manual PM), fill gate files, stage result
5. **Open implementation** — `approve-transition`
6. **Implementation turn** — `step` (manual dev), write code, stage result
7. **QA turn** — implementation auto-advances to `qa`; run `step` with `manual-qa`
8. **Complete the run** — `approve-completion`
9. **Verify** — `agentxchain status`, `agentxchain export`, `agentxchain report --input`

### Constraints

- Uses `manual-dev` + `manual-qa` so the tutorial is fully manual end to end
- Every command is copy-pasteable
- Every expected output is shown (abbreviated where long)
- Every gate file edit is shown with exact content
- No hand-waving ("fill in the files") — the tutorial provides the actual content to write
- Commits at natural boundaries (after scaffold, after each phase)

## Error Cases

- If the operator skips a gate file, `approve-transition` fails — tutorial explains this
- If `PM_SIGNOFF.md` stays at `Approved: NO`, the planning gate blocks — tutorial shows the fix
- If the operator leaves `dev` on `local-dev`, the implementation turn dispatches to the local coding CLI instead of the manual prompt — tutorial rebinds `dev` to `manual-dev`
- If the operator uses `api-qa` without a key, QA dispatch fails — tutorial rebinds `qa` to `manual-qa`
- If the operator runs `approve-transition` after implementation, the command fails because implementation auto-advances to `qa` after a passing accepted turn

## Acceptance Tests

- `AT-TUTORIAL-001`: Tutorial page exists at `website-v2/docs/tutorial.mdx` with frontmatter title
- `AT-TUTORIAL-002`: Sidebar includes `tutorial` entry
- `AT-TUTORIAL-003`: Tutorial contains the governed lifecycle commands: `init --governed`, `step`, `approve-transition`, `approve-completion`, `status`, `export`, `report --input`
- `AT-TUTORIAL-004`: Tutorial shows the fully manual runtime rebind: `local-dev` → `manual-dev`, `api-qa` → `manual-qa`
- `AT-TUTORIAL-005`: Tutorial shows exact gate file content (PM_SIGNOFF.md with `Approved: YES`, ROADMAP.md, SYSTEM_SPEC.md)
- `AT-TUTORIAL-006`: Tutorial shows `turn-result.json` examples
- `AT-TUTORIAL-007`: Tutorial links to getting-started and first-turn for reference detail
- `AT-TUTORIAL-008`: sitemap.xml and llms.txt include `/docs/tutorial`
- `AT-TUTORIAL-009`: Tutorial shows exactly one `approve-transition` command and explains that implementation auto-advances to `qa`
- `AT-TUTORIAL-010`: Subprocess E2E proves the fully manual tutorial path through `step` → `approve-transition` → `step` → `step` → `approve-completion`

## Open Questions

- None. Scope is deliberately narrow: one complete lifecycle, one template, fully manual execution.
