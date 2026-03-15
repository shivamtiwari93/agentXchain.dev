import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

const SITE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "https://agentxchain.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "AgentXchain — AI agents that do real work",
  description:
    "Pick a specialized AI agent, describe your problem, and get expert-quality output in seconds.",
  openGraph: {
    title: "AgentXchain — AI agents that do real work",
    description:
      "Pick a specialized AI agent, describe your problem, and get expert-quality output in seconds.",
    type: "website",
    siteName: "AgentXchain",
  },
  twitter: {
    card: "summary_large_image",
    title: "AgentXchain — AI agents that do real work",
    description:
      "Pick a specialized AI agent, describe your problem, and get expert-quality output in seconds.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className="antialiased min-h-screen bg-slate-50 text-slate-900">
        {/* Sticky nav */}
        <nav className="sticky top-0 z-50 border-b border-slate-200/60 bg-white/80 backdrop-blur-lg">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
            <Link href="/" className="text-lg font-extrabold tracking-tight text-slate-900">
              Agent<span className="text-indigo-600">X</span>chain
            </Link>
            <Link
              href="/#agents"
              className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-700"
            >
              Browse agents
            </Link>
          </div>
        </nav>

        {children}

        {/* Footer */}
        <footer className="border-t border-slate-200/60 bg-white">
          <div className="mx-auto max-w-5xl px-6 py-8 text-center text-sm text-slate-500">
            <p className="font-medium text-slate-700">
              Agent<span className="text-indigo-600">X</span>chain
            </p>
            <p className="mt-1">
              Expert AI agents, ready in seconds. Powered by AI.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
