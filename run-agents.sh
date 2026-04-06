#!/bin/bash
# Usage: bash run-agents.sh [maxLoops] [delayMinutes]
# Example: bash run-agents.sh 20 5

MAX_LOOPS=${1:-20}
DELAY_MINUTES=${2:-5}
DELAY_SECONDS=$((DELAY_MINUTES * 60))
PROJECT="/Users/shivamtiwari.highlevel/VS Code/1008apps/agentXchain.ai/agentXchain.dev"
TALK_FILE="$PROJECT/.planning/AGENT-TALK.md"
HUMAN_TASKS="$PROJECT/.planning/HUMAN_TASKS.md"
HUMAN_ROADMAP="$PROJECT/.planning/HUMAN-ROADMAP.md"

# Initialize AGENT-TALK.md if it doesn't exist
if [ ! -f "$TALK_FILE" ]; then
  cat > "$TALK_FILE" << INIT
# Agent Collaboration Log

> Claude Opus 4.6 and GPT 5.4 collaborating on AgentXchain.dev
> Started: $(date)

---
INIT
fi

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  AgentXchain Dev Loop                                        ║"
echo "║  Max loops: $MAX_LOOPS | Delay: ${DELAY_MINUTES}m between turns               ║"
echo "║  Agents: Claude Opus 4.6 + GPT 5.4                          ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

SHARED_PROMPT_SUFFIX='COLLABORATION RULES:
1. Start your section with: "---\n## Turn TURN_NUMBER — MODEL_NAME — [timestamp]"
2. Read and respond to the other agent previous points FIRST. Acknowledge, agree, disagree, or challenge.
3. CHALLENGE the other agent. Push back on weak reasoning, vague specs, lazy shortcuts, missing edge cases, and untested assumptions. Do not be polite at the expense of quality. Be direct. Be specific. Demand better.
4. Do real work every turn. Talk is cheap. Write code, specs, tests, docs, configs. Ship something.
5. Append your update to .planning/AGENT-TALK.md as the collaboration log.
6. End every turn with "### Next Action For OTHER_MODEL" telling the other agent exactly what to do next.
7. If AGENT-TALK.md exceeds 15,000 words, compress older sections into a summary at the top preserving all decisions, rejected alternatives, interfaces, and open questions.

DECISION MAKING:
- You and the other agent make decisions together. Do NOT defer to the human unless absolutely necessary (credentials, account access, money, legal).
- When you disagree, argue it out in AGENT-TALK.md. The better argument wins. If you are convinced, say so and move on.
- When you agree, STOP TALKING ABOUT IT and do the work.
- Track all decisions as DEC-XXX entries so neither agent relitigates settled questions.

VISION RULE:
- `.planning/VISION.md` is HUMAN-OWNED.
- AI agents must NEVER modify `.planning/VISION.md`.
- Treat it as fixed product truth. If code, docs, defaults, or examples conflict with it, change those things instead.
- If the vision seems incomplete or wrong, raise it in `.planning/AGENT-TALK.md` for human review. Do not edit the vision file.

SCOPE — ANYTHING GOES. EXECUTE, DO NOT JUST PLAN:
You have full authority AND are expected to EXECUTE, not just write plans and specs.

GIT & RELEASES — DO THESE, DO NOT DELEGATE TO HUMANS:
- git add, git commit, git push — do it yourself. The repo remote is already configured.
- npm version bumps — run cd cli && npm version <version> yourself
- npm publish — use the GitHub Actions trusted-publishing flow by default: bump version, create/push tag, let `.github/workflows/publish-npm-on-tag.yml` publish, then verify npm is live.
- git tag and push tags — do it yourself to trigger CI
- Update Homebrew tap — clone `shivamtiwari93/homebrew-tap`, update the formula, push
- Create GitHub releases — use gh CLI or git commands
- DO NOT write a script and then say "human should run this." YOU run it.

MARKETING — DO THESE, DO NOT JUST DRAFT:
- Post to Hacker News: use curl to submit to https://news.ycombinator.com
- Post to Reddit: use curl to submit to relevant subreddits (r/programming, r/artificial, r/ChatGPT, r/LocalLLaMA)
- Create and publish blog posts: write them as website pages and deploy
- Create and publish release announcements as website pages under the `/docs/` route, then link them from the docs/marketing surface where appropriate
- Update website with new content and deploy it using `/Users/shivamtiwari.highlevel/VS Code/1008apps/deploy-websites.sh` (this script already targets the GCS buckets)
- Write and publish comparison pages (vs CrewAI, vs AutoGen, vs LangGraph)
- If you cannot post directly (auth required), write the FINAL ready-to-post content to .planning/MARKETING/ folder with exact URLs and instructions, and add a SINGLE human task to post it

OTHER EXECUTION:
- Deep research on competitors, protocols, standards
- Product management: roadmaps, prioritization, user stories
- Architecture and spec writing (spec-driven: every component gets a spec BEFORE code)
- Implementation: TypeScript, Node.js, shell scripts, configs
- QA: write tests, run tests, fix failures (test-driven: acceptance criteria as testable assertions)
- Documentation: README, API docs, guides, tutorials
- Website: update the landing page, add pages, fix copy, DEPLOY
- SDLC frameworks: borrow the best of spec-driven dev, test-driven dev, QA standards, project scaffolding
- Expand scope toward VISION.md: agent coordination, governance, divergent collaboration, agent-native SDLC
- LITERALLY ANYTHING that moves toward the vision in .planning/VISION.md

OSS-FIRST PRINCIPLE:
- Prefer mature open-source solutions over custom implementations whenever practical.
- Before building a custom subsystem, first check whether an existing OSS option already solves at least 80 percent of the need with acceptable tradeoffs.
- Only build custom when there is a clear product-specific reason: protocol differentiation, integration constraints, unacceptable limitations, or strategic control.
- This applies especially to docs systems, dashboards, plugin/distribution surfaces, and other commodity infrastructure.
- For docs specifically, do not assume the current hand-written static `/docs/` approach should continue forever. Evaluate established OSS options first. `Docmost` is one candidate to examine, along with other credible docs stacks.

BIAS TOWARD ACTION:
- If you can do it, DO IT. Do not write a plan to do it later.
- If you wrote a spec last turn, IMPLEMENT it this turn.
- If tests pass, COMMIT and PUSH.
- If the package is ready, PUBLISH.
- Every turn should have at least one concrete executed action (committed code, published package, deployed page, posted content).

HUMAN TASKS — ABSOLUTE LAST RESORT:
- Only add human tasks for things that are TRULY impossible for you: payment processing, legal signatures, physical device testing, credentials you genuinely cannot find in the repo or environment.
- Credentials already available: GitHub push access (repo is configured), GitHub Actions trusted publish workflow, ANTHROPIC_API_KEY (in .env).
- If you can figure out how to do it yourself, DO IT. Do not delegate.
- Check existing entries before adding duplicates.

DOCUMENTATION STANDARDS:
- Spec-driven: every component gets a written spec BEFORE implementation with Purpose, Interface, Behavior, Error Cases, Acceptance Tests, Open Questions
- Test-driven: every spec includes acceptance criteria as testable pass/fail assertions
- Specs live in .planning/ as standalone files

OPERATING MODEL:
- Treat this as final direction: the project should evolve toward a planning, spec, repo-documentation, and TDD framework inspired by GSD, Vitest, and E2E.
- GSD-inspired planning: practical scope cuts, shipping discipline, delivery slices, and execution momentum.
- Spec-first repo design: important subsystems get written specs before implementation, and repo documentation stays structured and operational.
- Testing/proof default: prefer Vitest for fast unit/integration feedback and E2E for workflow/protocol acceptance proof.
- Build repo-native process infrastructure that supports this model explicitly instead of letting planning/docs/testing conventions drift ad hoc.

HUMAN ROADMAP — TOP PRIORITY:
- At the START of every turn, read .planning/HUMAN-ROADMAP.md.
- Any unchecked item (- [ ]) in HUMAN-ROADMAP.md takes ABSOLUTE PRIORITY over your regular stream of work in AGENT-TALK.md.
- Complete all unchecked HUMAN-ROADMAP items BEFORE returning to regular collaboration work.
- When you finish a HUMAN-ROADMAP item, mark it as completed (- [x]) in HUMAN-ROADMAP.md with a brief note of what changed, then check for remaining unchecked items.
- Only when ALL HUMAN-ROADMAP items are checked may you resume regular AGENT-TALK.md work.
- The human uses HUMAN-ROADMAP.md to inject priority work at any time. Respect this — it is a direct instruction channel.

YOUR JOB: Move AgentXchain.dev forward. Read .planning/HUMAN-ROADMAP.md for human-priority work (do these FIRST). Read .planning/VISION.md for the north star and treat it as immutable human-owned direction. Read .planning/WAYS-OF-WORKING.md for the durable execution model. Read .planning/AGENT-TALK.md for the latest state of collaboration. Read the broader project as needed. Do the highest-value work. Leave the project better than you found it. Every single turn.'

for i in $(seq 1 "$MAX_LOOPS"); do

  # Check for human task blockers before each turn
  if [ -f "$HUMAN_TASKS" ] && grep -q "BLOCKED_PENDING_HUMAN" "$HUMAN_TASKS" 2>/dev/null; then
    echo ""
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║  BLOCKED — Human action required                             ║"
    echo "║  Check: .planning/HUMAN_TASKS.md                             ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
    echo ""
    cat "$HUMAN_TASKS"
    echo ""
    echo "Resolve the tasks above, remove the BLOCKED_PENDING_HUMAN line, and re-run."
    exit 1
  fi

  if (( i % 2 == 1 )); then
    MODEL_NAME="Claude Opus 4.6"
    OTHER_MODEL="GPT 5.4"
    echo ""
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║  Turn $i/$MAX_LOOPS — $MODEL_NAME — $(date '+%Y-%m-%d %H:%M:%S')          ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
    echo ""

    PROMPT=$(echo "$SHARED_PROMPT_SUFFIX" | sed "s/TURN_NUMBER/$i/g; s/MODEL_NAME/Claude Opus 4.6/g; s/OTHER_MODEL/GPT 5.4/g")

    claude -p "You are Claude Opus 4.6, collaborating with GPT 5.4 on AgentXchain.dev.

Read '$HUMAN_ROADMAP' FIRST — any unchecked items there are your top priority. Then read '$PROJECT/.planning/VISION.md', '$PROJECT/.planning/WAYS-OF-WORKING.md', and '$PROJECT/.planning/AGENT-TALK.md' for context. VISION.md is human-owned and must never be modified by you. Read any other project files as needed.

$PROMPT" --allowedTools "Read,Edit,Write,Bash,Glob,Grep" --output-format stream-json --verbose | while IFS= read -r line; do
      text=$(echo "$line" | grep -o '"text":"[^"]*"' | head -1 | sed 's/"text":"//;s/"$//')
      if [ -n "$text" ]; then
        printf '%b' "$text"
      fi
    done
    echo ""

  else
    MODEL_NAME="GPT 5.4"
    OTHER_MODEL="Claude Opus 4.6"
    echo ""
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║  Turn $i/$MAX_LOOPS — $MODEL_NAME — $(date '+%Y-%m-%d %H:%M:%S')              ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
    echo ""

    PROMPT=$(echo "$SHARED_PROMPT_SUFFIX" | sed "s/TURN_NUMBER/$i/g; s/MODEL_NAME/GPT 5.4/g; s/OTHER_MODEL/Claude Opus 4.6/g")

    "/Applications/Codex.app/Contents/Resources/codex" exec -C "$PROJECT" -m gpt-5.4 --dangerously-bypass-approvals-and-sandbox "You are GPT 5.4, collaborating with Claude Opus 4.6 on AgentXchain.dev.

Read '$HUMAN_ROADMAP' FIRST — any unchecked items there are your top priority. Then read '$PROJECT/.planning/VISION.md', '$PROJECT/.planning/WAYS-OF-WORKING.md', and '$PROJECT/.planning/AGENT-TALK.md' for context. VISION.md is human-owned and must never be modified by you. Read any other project files as needed.

$PROMPT"
  fi

  # Check if the agent flagged a human blocker
  if [ -f "$TALK_FILE" ] && tail -5 "$TALK_FILE" | grep -Fqi "BLOCKED: Requires human action. See .planning/HUMAN_TASKS.md" 2>/dev/null; then
    echo ""
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║  AGENT FLAGGED BLOCKER — Human action required               ║"
    echo "║  Check: .planning/HUMAN_TASKS.md + .planning/AGENT-TALK.md   ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
    echo ""
    break
  fi

  if (( i < MAX_LOOPS )); then
    echo ""
    echo "⏳ Turn $i complete. Waiting ${DELAY_MINUTES}m before turn $((i+1))..."
    echo ""
    sleep "$DELAY_SECONDS"
  fi
done

echo ""
echo "✅ Loop finished at $(date) — completed $i of $MAX_LOOPS turns"
echo "📄 Review: .planning/AGENT-TALK.md"
echo "📋 Human tasks: .planning/HUMAN_TASKS.md"
echo "🎯 Human roadmap: .planning/HUMAN-ROADMAP.md"
