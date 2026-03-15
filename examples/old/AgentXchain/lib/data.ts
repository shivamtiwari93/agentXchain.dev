/**
 * Data models and seed agents for AgentXchain MVP.
 */

export interface AgentTheme {
  iconBg: string;
  iconSvg: string;
  tagBg: string;
  tagText: string;
  ctaBg: string;
  ctaHover: string;
  headerGradient: string;
  accentBorder: string;
}

export interface Agent {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  tags: string[];
  exampleInput: string;
  examplePrompts: string[];
  theme: AgentTheme;
}

export interface Job {
  id: string;
  agentSlug: string;
  input: string;
  status: "queued" | "running" | "completed" | "failed";
  result?: string;
  error?: string;
  createdAt: number;
}

export const AGENTS: Agent[] = [
  {
    id: "1",
    slug: "landing-page-critic",
    name: "Landing Page Critic",
    tagline: "Turn your landing page into a conversion machine",
    description:
      "Paste your landing page copy and get actionable suggestions to improve clarity, persuasion, and conversion. Focused on clarity, value proposition, and calls to action.",
    tags: ["copy", "conversion", "landing page"],
    exampleInput:
      "We help small businesses automate their marketing. Sign up for a free trial today.",
    examplePrompts: [
      "We help small businesses automate their marketing. Sign up for a free trial today.",
      "Get your free demo in 30 seconds. No credit card required.",
      "The best CRM for startups. Trusted by 10,000+ teams worldwide.",
    ],
    theme: {
      iconBg: "bg-gradient-to-br from-orange-400 to-amber-500",
      iconSvg: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-7 h-7"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"/></svg>`,
      tagBg: "bg-orange-100",
      tagText: "text-orange-700",
      ctaBg: "bg-gradient-to-r from-orange-500 to-amber-500",
      ctaHover: "hover:from-orange-600 hover:to-amber-600",
      headerGradient: "bg-gradient-to-r from-orange-500 via-amber-500 to-yellow-500",
      accentBorder: "border-l-orange-500",
    },
  },
  {
    id: "2",
    slug: "cold-email-writer",
    name: "Cold Email Writer",
    tagline: "Write outreach emails that actually get replies",
    description:
      "Describe your product and target audience. Get a short, personalized cold email draft designed to get opened and replied to.",
    tags: ["sales", "outreach", "email"],
    exampleInput:
      "I sell project management software to marketing agencies with 10-50 employees.",
    examplePrompts: [
      "I sell project management software to marketing agencies with 10-50 employees.",
      "We offer HR onboarding software for companies with 100-500 employees.",
      "I'm reaching out to CTOs at Series A SaaS companies about our API security tool.",
    ],
    theme: {
      iconBg: "bg-gradient-to-br from-blue-400 to-cyan-500",
      iconSvg: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-7 h-7"><path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75"/></svg>`,
      tagBg: "bg-blue-100",
      tagText: "text-blue-700",
      ctaBg: "bg-gradient-to-r from-blue-500 to-cyan-500",
      ctaHover: "hover:from-blue-600 hover:to-cyan-600",
      headerGradient: "bg-gradient-to-r from-blue-500 via-cyan-500 to-teal-500",
      accentBorder: "border-l-blue-500",
    },
  },
  {
    id: "3",
    slug: "support-reply-assistant",
    name: "Support Reply Assistant",
    tagline: "Turn angry tickets into happy customers",
    description:
      "Paste a customer complaint or support ticket. Get a empathetic, professional reply that addresses the issue and suggests a resolution.",
    tags: ["support", "customer success", "replies"],
    exampleInput:
      "Your product crashed and I lost 2 hours of work. This is unacceptable and I want a refund immediately.",
    examplePrompts: [
      "Your product crashed and I lost 2 hours of work. This is unacceptable and I want a refund immediately.",
      "I've been waiting 5 days for a response. This is terrible customer service.",
      "The feature you advertised doesn't work. I want my money back.",
    ],
    theme: {
      iconBg: "bg-gradient-to-br from-emerald-400 to-green-500",
      iconSvg: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-7 h-7"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334a2.126 2.126 0 0 0-.476-.095 48.64 48.64 0 0 0-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155"/></svg>`,
      tagBg: "bg-emerald-100",
      tagText: "text-emerald-700",
      ctaBg: "bg-gradient-to-r from-emerald-500 to-green-500",
      ctaHover: "hover:from-emerald-600 hover:to-green-600",
      headerGradient: "bg-gradient-to-r from-emerald-500 via-green-500 to-teal-500",
      accentBorder: "border-l-emerald-500",
    },
  },
];

export function getAgentBySlug(slug: string): Agent | undefined {
  return AGENTS.find((a) => a.slug === slug);
}
