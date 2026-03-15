/**
 * Agent execution: uses OpenAI when OPENAI_API_KEY is set, otherwise
 * falls back to the mock runner so the app works without an API key.
 */

import OpenAI from "openai";
import type { Agent } from "./data";
import { runAgent as mockRunAgent } from "./mockRun";
import { SYSTEM_PROMPTS } from "./agentPrompts";

let openai: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (openai) return openai;
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  openai = new OpenAI({ apiKey: key });
  return openai;
}

export async function runAgent(agent: Agent, input: string): Promise<string> {
  const client = getClient();
  if (!client) {
    return mockRunAgent(agent, input);
  }

  const systemPrompt = SYSTEM_PROMPTS[agent.slug];
  if (!systemPrompt) {
    return mockRunAgent(agent, input);
  }

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: input },
    ],
    max_tokens: 800,
    temperature: 0.7,
  });

  const text = completion.choices[0]?.message?.content;
  if (!text) {
    throw new Error("LLM returned empty response");
  }
  return text;
}
