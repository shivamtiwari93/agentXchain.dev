> Public contract for the `/launch` page and launch-linked marketing drafts.

# Launch Page Spec

## Purpose

Keep the public launch surface honest and conversion-oriented.

The launch page is not a generic homepage remix. It is the canonical page for launch traffic from Hacker News, Reddit, and direct release links. It must tell the current release story without introducing new truth drift.

## Interface

- Public page: `website-v2/src/pages/launch.mdx`
- Public route: `/launch`
- Linked from: `website-v2/docusaurus.config.ts`
- Launch-linked drafts:
  - `.planning/MARKETING/HN_SUBMISSION.md`
  - `.planning/MARKETING/REDDIT_POSTS.md`
  - `.planning/MARKETING/TWITTER_THREAD.md`

## Behavior

1. The page must position `/launch` as the canonical release/launch surface for public traffic.
2. The page must keep the proof boundary precise:
   - all four adapter types are proven live
   - `local_cli`, `api_proxy`, and `mcp` are the adapters with real-model proof
   - `manual` is the human control-path adapter and must not be described as a real-model proof
3. The page must keep the demo front door strong:
   - `npx --yes -p agentxchain@latest -c "agentxchain demo"` is the primary demo command (package-bound per `DEC-NPX-FD-001`)
4. The Hacker News draft must use `https://agentxchain.dev/launch` as the submission URL, not the generic homepage.
5. Launch-linked drafts must not repeat the false shorthand that "all four adapters are proven live with real AI models."

## Error Cases

- Launch page says manual adapter proof is a real-model proof.
- HN draft submits traffic to `/` instead of `/launch`.
- Demo instructions omit the known stale-global-install fallback.
- Marketing drafts collapse "all adapters proven live" into "every adapter proven with a real model."

## Acceptance Tests

- `AT-LAUNCH-PAGE-001`: `website-v2/src/pages/launch.mdx` exists and includes the explicit fallback command `npx -p agentxchain@2.24.1 -c 'agentxchain demo'`.
- `AT-LAUNCH-PAGE-002`: `website-v2/src/pages/launch.mdx` states that all four adapters are proven live and distinguishes the three real-model adapters from the manual adapter.
- `AT-LAUNCH-PAGE-003`: `.planning/MARKETING/HN_SUBMISSION.md` uses `https://agentxchain.dev/launch` as the submission URL.
- `AT-LAUNCH-PAGE-004`: launch-linked marketing drafts do not say that the manual adapter is proven with a real AI model.

## Open Questions

- Should the root homepage temporarily promote `/launch` more aggressively during the immediate release window, or is navbar discoverability sufficient?
