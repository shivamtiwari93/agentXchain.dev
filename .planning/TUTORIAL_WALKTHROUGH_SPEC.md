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
2. **Scaffold** — `init --governed --template cli-tool -y`
3. **Planning turn** — `step` (manual PM), fill gate files, stage result
4. **Open implementation** — `approve-transition`
5. **Implementation turn** — `step` (manual dev), write code, stage result
6. **Open QA** — `approve-transition`
7. **QA turn** — `step` with `manual-qa` runtime (no API key needed)
8. **Complete the run** — `approve-completion`
9. **Verify** — `agentxchain status`, governance report

### Constraints

- Uses `manual-qa` throughout so the tutorial is zero-API-key end to end
- Every command is copy-pasteable
- Every expected output is shown (abbreviated where long)
- Every gate file edit is shown with exact content
- No hand-waving ("fill in the files") — the tutorial provides the actual content to write
- Commits at natural boundaries (after scaffold, after each phase)

## Error Cases

- If the operator skips a gate file, `approve-transition` fails — tutorial explains this
- If `PM_SIGNOFF.md` stays at `Approved: NO`, the planning gate blocks — tutorial shows the fix
- If the operator uses `api-qa` without a key, QA dispatch fails — tutorial uses `manual-qa` to avoid this

## Acceptance Tests

- `AT-TUTORIAL-001`: Tutorial page exists at `website-v2/docs/tutorial.mdx` with frontmatter title
- `AT-TUTORIAL-002`: Sidebar includes `tutorial` entry
- `AT-TUTORIAL-003`: Tutorial contains all 8 lifecycle commands: `init --governed`, `step`, `approve-transition` (×2), `approve-completion`, `status`
- `AT-TUTORIAL-004`: Tutorial mentions `manual-qa` runtime config edit
- `AT-TUTORIAL-005`: Tutorial shows exact gate file content (PM_SIGNOFF.md with `Approved: YES`, ROADMAP.md, SYSTEM_SPEC.md)
- `AT-TUTORIAL-006`: Tutorial shows `turn-result.json` examples
- `AT-TUTORIAL-007`: Tutorial links to getting-started and first-turn for reference detail
- `AT-TUTORIAL-008`: sitemap.xml and llms.txt include `/docs/tutorial`

## Open Questions

- None. Scope is deliberately narrow: one complete lifecycle, one template, zero API keys.
