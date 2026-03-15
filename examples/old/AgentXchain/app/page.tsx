import Link from "next/link";
import { AGENTS } from "@/lib/data";

export default function HomePage() {
  const agents = AGENTS;

  return (
    <main className="min-h-screen bg-slate-50">
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-indigo-600 via-purple-600 to-blue-700">
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-10 left-10 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute bottom-10 right-10 h-96 w-96 rounded-full bg-purple-300/10 blur-3xl" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-64 w-64 rounded-full bg-blue-300/10 blur-3xl" />
        </div>
        <div className="relative mx-auto max-w-4xl px-6 py-24 text-center">
          <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl lg:text-6xl">
            AI agents that do real work.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-white/80">
            Pick a specialized AI agent, describe your problem, and get expert-quality output in seconds — no signup required.
          </p>
          <a
            href="#agents"
            className="mt-8 inline-flex items-center gap-2 rounded-full bg-white/10 px-6 py-3 text-sm font-semibold text-white ring-1 ring-white/25 backdrop-blur transition hover:bg-white/20 hover:ring-white/40"
          >
            Explore agents
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5 12 21m0 0-7.5-7.5M12 21V3" />
            </svg>
          </a>
        </div>
      </section>

      {/* How it Works */}
      <section className="mx-auto max-w-4xl px-6 py-16">
        <h2 className="text-center text-sm font-semibold uppercase tracking-wider text-slate-500">
          How it works
        </h2>
        <p className="mt-2 text-center text-2xl font-bold text-slate-900">
          Three steps. Seconds each.
        </p>
        <div className="mt-10 grid gap-8 sm:grid-cols-3">
          {[
            {
              step: "1",
              title: "Pick an agent",
              text: "Choose from our curated collection of specialized AI agents, each built for a specific business task.",
            },
            {
              step: "2",
              title: "Describe your problem",
              text: "Paste your copy, describe your audience, or share a customer complaint. Use an example prompt or write your own.",
            },
            {
              step: "3",
              title: "Get expert results",
              text: "Receive actionable, professional output in seconds. Copy it to your clipboard and put it to work immediately.",
            },
          ].map((item) => (
            <div key={item.step} className="text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-600">
                {item.step}
              </div>
              <h3 className="mt-3 text-base font-semibold text-slate-900">{item.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{item.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Agent Cards */}
      <section id="agents" className="mx-auto max-w-5xl px-6 pb-16">
        <h2 className="text-center text-sm font-semibold uppercase tracking-wider text-slate-500">
          Available agents
        </h2>
        <p className="mt-2 text-center text-2xl font-bold text-slate-900">
          Choose your expert
        </p>
        <ul className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <li key={agent.slug}>
              <Link
                href={`/agents/${agent.slug}`}
                className="group relative flex flex-col rounded-2xl border border-slate-200/80 bg-white p-6 shadow-lg transition-all hover:-translate-y-1 hover:shadow-xl"
              >
                {/* Icon */}
                <div
                  className={`flex h-14 w-14 items-center justify-center rounded-xl text-white shadow-md ${agent.theme.iconBg}`}
                  dangerouslySetInnerHTML={{ __html: agent.theme.iconSvg }}
                />
                {/* Name */}
                <h3 className="mt-4 text-lg font-bold text-slate-900">
                  {agent.name}
                </h3>
                {/* Tagline */}
                <p className="mt-1 text-sm leading-relaxed text-slate-600">
                  {agent.tagline}
                </p>
                {/* Tags */}
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
                {/* CTA */}
                <div className="mt-auto pt-5">
                  <span
                    className={`block w-full rounded-xl py-2.5 text-center text-sm font-semibold text-white shadow-sm transition-all ${agent.theme.ctaBg} ${agent.theme.ctaHover} group-hover:shadow-md`}
                  >
                    Try this agent &rarr;
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
