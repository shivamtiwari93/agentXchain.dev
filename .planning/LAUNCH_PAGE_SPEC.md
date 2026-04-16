> Public contract for the `/launch` page and launch-linked marketing drafts.

# Launch Page Spec

## Purpose

Keep the public launch surface honest without mixing historical launch copy and current reusable marketing drafts into one vague blob.

`/launch` is a historical v2.24.1 launch snapshot. The repo also keeps reusable launch-linked drafts under `.planning/MARKETING/`. Those drafts are not archival copy. They must track the current release truth.

## Interface

- Public page: `website-v2/src/pages/launch.mdx`
- Public route: `/launch`
- Linked from: `website-v2/docusaurus.config.ts`
- Launch-linked drafts:
  - `.planning/MARKETING/HN_SUBMISSION.md`
  - `.planning/MARKETING/REDDIT_POSTS.md`
  - `.planning/MARKETING/TWITTER_THREAD.md`

## Behavior

1. `/launch` must remain a clearly labeled historical launch snapshot:
   - it may preserve v2.24.1 launch-time counts and the four-adapter launch story
   - it must label those claims as launch-time snapshot truth, not current release truth
   - the page title, metadata, opening paragraph, and adapter-proof section headings must read as historical launch-time claims, not current-tense front-door copy
   - the five-layer connector description may preserve the launch-time four-adapter subset, but it must explicitly label that subset as the v2.24.1 launch boundary
2. The page must keep the demo front door strong:
   - `npx --yes -p agentxchain@latest -c "agentxchain demo"` is the primary demo command (package-bound per `DEC-NPX-FD-001`)
3. Reusable current-truth marketing drafts must send primary traffic to a current front door, not the historical `/launch` snapshot:
   - the Hacker News submission URL must be `https://agentxchain.dev`
   - reusable draft link lists may link the homepage and current docs, but must not present `/launch` as the primary CTA
4. Launch-linked drafts under `.planning/MARKETING/` must track current release truth:
   - current released version from `cli/package.json`
   - current aggregate evidence line from the top `cli/CHANGELOG.md` section
   - current conformance corpus size
5. Launch-linked drafts must keep the current adapter-proof boundary precise:
   - all five adapter types are proven live
   - `local_cli`, `api_proxy`, `mcp`, and `remote_agent` have real-model proof
   - `manual` is the human control-path adapter and must not be described as real-model proof

## Error Cases

- `/launch` presents historical launch counts as if they are current release truth.
- `/launch` title, metadata, or opening paragraph sounds like a current release landing page instead of a historical launch snapshot.
- Launch page says manual adapter proof is a real-model proof.
- Launch page lists the four-adapter launch subset in the architecture section without saying it is the v2.24.1 launch-time boundary.
- A reusable current-truth draft sends primary traffic to the historical `/launch` snapshot instead of a current front door.
- Demo instructions omit the known stale-global-install fallback.
- Marketing drafts collapse "all adapters proven live" into "every adapter proven with a real model."
- Marketing drafts lag the current release version, evidence line, or conformance corpus size.

## Acceptance Tests

- `AT-LAUNCH-PAGE-001`: `website-v2/src/pages/launch.mdx` exists and includes the explicit fallback command `npx -p agentxchain@2.24.1 -c 'agentxchain demo'`.
- `AT-LAUNCH-PAGE-002`: `website-v2/src/pages/launch.mdx` preserves the historical four-adapter launch snapshot and labels it as historical snapshot truth.
- `AT-LAUNCH-PAGE-003`: `.planning/MARKETING/HN_SUBMISSION.md` uses `https://agentxchain.dev` as the submission URL, and reusable current-truth marketing drafts do not present `https://agentxchain.dev/launch` as the primary CTA.
- `AT-LAUNCH-PAGE-004`: launch-linked marketing drafts do not say that the manual adapter is proven with a real AI model.
- `AT-LAUNCH-PAGE-005`: launch-linked marketing drafts carry the current released version from `cli/package.json`.
- `AT-LAUNCH-PAGE-006`: launch-linked marketing drafts carry the current release evidence line from the top `cli/CHANGELOG.md` section and the current conformance corpus size.
- `AT-LAUNCH-PAGE-007`: launch-linked marketing drafts state that all five adapter types are proven live and include `remote_agent` in the non-manual real-model proof boundary.
- `AT-LAUNCH-PAGE-008`: `website-v2/src/pages/launch.mdx` labels its title, metadata, opening paragraph, adapter-proof heading, and architecture connector subset as historical launch-time snapshot truth.

## Open Questions

- Should the root homepage temporarily promote `/launch` more aggressively during the immediate release window, or is navbar discoverability sufficient?
