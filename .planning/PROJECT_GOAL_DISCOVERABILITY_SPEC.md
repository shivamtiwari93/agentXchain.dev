# Project Goal Discoverability Spec

## Purpose

Ensure that the `project.goal` capability (shipped in v2.56.0) is discoverable to new operators through every front-door surface. A feature that works correctly but cannot be found through the onboarding path is a hidden feature.

## Problem

After v2.56.0, `project.goal` was documented only in the CLI reference (`cli.mdx`). The three primary onboarding surfaces (README, quickstart, getting-started) and the `init --governed` post-init CLI output contained no mention of `--goal` or `project.goal`.

## Solution

Add `--goal` / `project.goal` mentions to all four front-door surfaces:

1. **`cli/src/commands/init.js`** — when no goal was set, print a tip suggesting `--goal` or manual `project.goal` in config.
2. **`website-v2/docs/getting-started.mdx`** — add an "Optional" block after the scaffold command showing `--goal` usage.
3. **`website-v2/docs/quickstart.mdx`** — add a tip after the first init example mentioning `--goal`.
4. **`README.md`** — add a `--goal` example after the quick-start scaffold block.

## Acceptance Tests

- `AT-PGD-001`: `init --governed` without `--goal` prints a tip containing `--goal` in its post-init output.
- `AT-PGD-002`: `init --governed --goal "..."` does NOT print the `--goal` tip (goal already set).
- `AT-PGD-003`: `getting-started.mdx` contains `--goal` or `project.goal`.
- `AT-PGD-004`: `quickstart.mdx` contains `--goal` or `project.goal`.
- `AT-PGD-005`: `README.md` contains `--goal` or `project.goal`.

## Non-Scope

- Changing the `project.goal` runtime behavior (already shipped and proven).
- Adding goal to template scaffolds (goal is intentionally operator-supplied, not template-default).

## Decision

- `DEC-PROJECT-GOAL-DISCOVERABILITY-001`: `project.goal` must be mentioned in all front-door surfaces. A feature that only exists in the CLI reference is undiscoverable.
