/**
 * V0: mock agent execution. Returns placeholder output so the flow works
 * without an LLM API key. Replace with real LLM call when ready.
 */

import type { Agent } from "./data";

export async function runAgent(agent: Agent, input: string): Promise<string> {
  await new Promise((r) => setTimeout(r, 800)); // simulate latency
  switch (agent.slug) {
    case "landing-page-critic":
      return `**Conversion suggestions for your copy:**\n\n1. **Lead with the outcome** — Start with what the customer gets (e.g. "Save 5 hours a week on marketing") instead of what you do.\n2. **Sharpen the CTA** — "Sign up for a free trial" is generic. Try "Start your free trial — no credit card required" or "Get my free trial".\n3. **Add social proof** — One short line like "Join 2,000+ small businesses" builds trust.\n\nYour current copy: "${input.slice(0, 80)}${input.length > 80 ? "…" : ""}"`;
    case "cold-email-writer":
      return `**Subject:** Quick question about [pain point]\n\nHi [First Name],\n\nI noticed [specific observation about their business]. Many agencies we work with were spending too much time on [related pain].\n\nWe built [Product] so teams like yours can [outcome]. Would a 10-minute call this week make sense to see if it's a fit?\n\nBest,\n[Your name]\n\n---\n*Based on your input: ${input.slice(0, 60)}…*`;
    case "support-reply-assistant":
      return `**Suggested reply:**\n\nHi [Customer name],\n\nI'm really sorry to hear you ran into this. Losing work is frustrating, and we want to make it right.\n\nCould you tell me which feature you were using when the crash happened and whether you were able to recover any drafts? That will help us fix the issue and prevent it for others.\n\nRegarding a refund — we're happy to process that. I've forwarded your case to our billing team; they'll reach out within 24 hours with next steps.\n\nAgain, I apologize for the experience. If you'd like to continue using the product, we can also offer [compensation, e.g. extended trial] as a gesture of goodwill.\n\nBest,\n[Support agent]`;
    default:
      return `Mock output for "${agent.name}" with input: ${input.slice(0, 100)}…`;
  }
}
