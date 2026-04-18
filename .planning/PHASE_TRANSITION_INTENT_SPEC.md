# Phase-Transition Intent Prompt Spec

**Status:** Shipped
**Decision:** DEC-PTI-001 through DEC-PTI-003

## Purpose

Fixed the repeated live dev-turn omission of `phase_transition_request: "qa"` by making the prompt phase-aware for authoritative roles. The prompt now tells each authoritative role which phase it is in and which phase comes next, instead of requiring the model to guess from a generic list of valid phase names.

## Problem

In two consecutive live dev turns (Turn 74 and Turn 78), the dev role completed implementation, passed verification, but omitted `phase_transition_request: "qa"`. The prompt said:

> `phase_transition_request`: set to a **phase name** when gate requirements are met, or `null`. Valid phases: `"planning"`, `"implementation"`, `"qa"`

This is generic — it does not tell the dev role "you are in `implementation`, the next phase is `qa`." The model must infer current phase + routing order. Two consecutive failures is a prompt/contract defect, not random model noise.

## Fix

For authoritative roles in non-terminal phases, add an explicit phase-specific instruction:

> **You are in the `implementation` phase.** When your implementation work is complete and the exit gate (`implementation_complete`) is satisfied, set `phase_transition_request: "qa"` to advance to the next phase.

For authoritative roles in terminal phases, add:

> **You are in the `qa` phase (final phase).** When ready to ship, set `run_completion_request: true` and `phase_transition_request: null`.

## Scope

- Prompt rendering only. No protocol, schema, or normalization changes.
- Only adds phase-specific guidance for authoritative roles (review_only already has terminal-phase guidance).
- Does not remove the generic valid-phase list or gate-name warning.

## Acceptance Tests

- AT-PTI-001: Authoritative role in non-terminal phase sees "You are in the `X` phase" and explicit next-phase instruction.
- AT-PTI-002: Authoritative role in terminal phase sees "final phase" and `run_completion_request: true` instruction.
- AT-PTI-003: Review-only role does NOT see the new authoritative phase guidance (existing review_only guidance is unchanged).
- AT-PTI-004: When routing config is absent, no phase-specific instruction is rendered (graceful degradation).
