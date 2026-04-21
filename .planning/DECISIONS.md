# Decisions — AgentXchain

Canonical decision ledger for durable repo-operating decisions. Older decisions still exist inline in `.planning/AGENT-TALK.md`; new or updated durable decisions should be added here when they affect release, CI/CD, governance, or protocol contracts.

## DEC-RELEASE-CUT-AND-PUSH-AS-ATOMIC-001

**Status:** Active, updated 2026-04-21 by CICD-SHRINK.

**Decision:** A release-cut turn is not complete until the version bump, release-surface alignment, commit, tag, push, publish workflow observation, downstream verification, and collaboration log are all handled in the same execution chain.

**Precondition added by CICD-SHRINK:** Before creating any release tag, the release-cut turn MUST run:

```bash
bash cli/scripts/prepublish-gate.sh <target-version>
```

The turn's Evidence block MUST include the gate's exact `PREPUBLISH GATE PASSED for <version>` line. If the gate fails, agents must not create the tag, push the tag, or trigger the publish workflow. The local gate replaces the per-commit CI coverage removed by restricting `ci.yml` to pull-request events.

**Why:** The v2.149.x release incident showed that push-to-main CI density can saturate GitHub Free concurrent slots and block the OIDC publish path for hours. Release safety now depends on a local, explicit, logged gate before tag creation.

## DEC-GITHUB-ACTIONS-FOOTPRINT-FLOOR-001

**Status:** Active as of 2026-04-21.

**Decision:** AgentXchain.dev's steady-state GitHub Actions footprint is intentionally small:

- `publish-npm-on-tag.yml` on `v*.*.*` tags and manual dispatch, because npm trusted publishing requires GitHub Actions OIDC.
- `deploy-gcs.yml` on `website-v2/**`, `docs/**`, or deploy-workflow changes, because production website deploy credentials live in GitHub Actions.
- `governed-todo-app-proof.yml` on nightly schedule, release tags, and manual dispatch, because the public example proof is useful but too expensive for every push.
- `publish-vscode-on-tag.yml` on `vsce-v*.*.*` tags and manual dispatch, because VS Code Marketplace publish is a separate release channel.
- CodeQL default setup on weekly schedule, verified through GitHub default setup rather than a repo-owned workflow file.

All other test/proof work is local-first through `cli/scripts/prepublish-gate.sh`.

Adding a workflow that fires on every push to `main` requires explicit human approval through `.planning/HUMAN-ROADMAP.md` and a written justification that the failure mode cannot be covered by the local prepublish gate.

**Why:** Push-to-main workflows created 19 zombie CI runs during the v2.149.x cycle, saturating the 20-slot GitHub Free account limit and stalling release publication. The repo should spend remote workflow capacity only on work that cannot be done locally or that is intentionally low-frequency.
