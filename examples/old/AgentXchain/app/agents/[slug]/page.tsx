import Link from "next/link";
import { notFound } from "next/navigation";
import { getAgentBySlug } from "@/lib/data";
import { RunAgentForm } from "./RunAgentForm";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function AgentDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const agent = getAgentBySlug(slug);
  if (!agent) notFound();

  return (
    <main className="min-h-screen bg-slate-50">
      {/* Colored header banner */}
      <header className={`relative overflow-hidden ${agent.theme.headerGradient}`}>
        <div className="absolute inset-0 opacity-20">
          <div className="absolute -top-10 -right-10 h-48 w-48 rounded-full bg-white/20 blur-3xl" />
        </div>
        <div className="relative mx-auto max-w-2xl px-6 py-10">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm font-medium text-white/80 transition hover:text-white"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            Back to agents
          </Link>
          <div className="mt-4 flex items-center gap-4">
            <div
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white/20 text-white shadow-lg backdrop-blur"
              dangerouslySetInnerHTML={{ __html: agent.theme.iconSvg }}
            />
            <div>
              <h1 className="text-2xl font-extrabold text-white">
                {agent.name}
              </h1>
              <p className="mt-0.5 text-white/80">{agent.tagline}</p>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-6 py-8">
        <p className="text-base leading-relaxed text-slate-700">{agent.description}</p>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {agent.tags.map((tag) => (
            <span
              key={tag}
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${agent.theme.tagBg} ${agent.theme.tagText}`}
            >
              {tag}
            </span>
          ))}
        </div>

        <RunAgentForm
          agentSlug={agent.slug}
          agentName={agent.name}
          exampleInput={agent.exampleInput}
          examplePrompts={agent.examplePrompts}
          ctaBg={agent.theme.ctaBg}
          ctaHover={agent.theme.ctaHover}
          accentBorder={agent.theme.accentBorder}
        />
      </div>
    </main>
  );
}
