"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

const MAX_FREE_RUNS = 3;

interface RunAgentFormProps {
  agentSlug: string;
  agentName: string;
  exampleInput: string;
  examplePrompts: string[];
  ctaBg: string;
  ctaHover: string;
  accentBorder: string;
}

function ResultMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1.5 text-sm leading-relaxed text-slate-700">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <br key={i} />;
        const numMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
        if (numMatch)
          return (
            <p key={i} className="ml-4 flex gap-2">
              <span className="font-semibold text-slate-500">{numMatch[1]}.</span>
              <span>{renderInlineBold(numMatch[2])}</span>
            </p>
          );
        if (trimmed.startsWith("- ") || trimmed.startsWith("* "))
          return (
            <p key={i} className="ml-4 flex gap-2">
              <span className="text-slate-400">&bull;</span>
              <span>{renderInlineBold(trimmed.slice(2))}</span>
            </p>
          );
        return <p key={i}>{renderInlineBold(trimmed)}</p>;
      })}
    </div>
  );
}

function renderInlineBold(str: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let rest = str;
  let key = 0;
  while (rest.length > 0) {
    const open = rest.indexOf("**");
    if (open === -1) {
      parts.push(<span key={key++}>{rest}</span>);
      break;
    }
    const before = rest.slice(0, open);
    if (before) parts.push(<span key={key++}>{before}</span>);
    const afterOpen = rest.slice(open + 2);
    const close = afterOpen.indexOf("**");
    if (close === -1) {
      parts.push(<span key={key++}>{rest}</span>);
      break;
    }
    parts.push(<strong key={key++} className="font-semibold text-slate-900">{afterOpen.slice(0, close)}</strong>);
    rest = afterOpen.slice(close + 2);
  }
  return <>{parts}</>;
}

export function RunAgentForm({
  agentSlug,
  agentName,
  exampleInput,
  examplePrompts,
  ctaBg,
  ctaHover,
  accentBorder,
}: RunAgentFormProps) {
  const [input, setInput] = useState(exampleInput);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [result, setResult] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [runsUsed, setRunsUsed] = useState(0);
  const [isMounted, setIsMounted] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    const storedRuns = localStorage.getItem("agentxchain_runs");
    if (storedRuns) {
      setRunsUsed(parseInt(storedRuns, 10));
    }
    const storedJobId = localStorage.getItem(`agentxchain_job_${agentSlug}`);
    if (storedJobId) {
      setStatus("loading");
      pollJob(storedJobId)
        .then((res) => {
          setResult(res);
          setStatus("success");
        })
        .catch(() => {
          setStatus("idle");
          localStorage.removeItem(`agentxchain_job_${agentSlug}`);
        });
    }
  }, [agentSlug]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (runsUsed >= MAX_FREE_RUNS) return;

    setStatus("loading");
    setResult(null);
    setErrorMessage(null);

    try {
      const runRes = await fetch(`/api/agents/${agentSlug}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });

      if (!runRes.ok) {
        const data = await runRes.json().catch(() => ({}));
        throw new Error(data.error || `Request failed: ${runRes.status}`);
      }

      const { jobId } = await runRes.json();
      localStorage.setItem(`agentxchain_job_${agentSlug}`, jobId);
      const newRunsUsed = runsUsed + 1;
      setRunsUsed(newRunsUsed);
      localStorage.setItem("agentxchain_runs", newRunsUsed.toString());

      const jobResult = await pollJob(jobId);
      setResult(jobResult);
      setStatus("success");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong");
      setStatus("error");
    }
  }

  const outOfRuns = runsUsed >= MAX_FREE_RUNS;

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">Try this agent</h2>
        {isMounted && (
          <span className={`text-sm font-medium ${outOfRuns ? "text-amber-600" : "text-slate-500"}`}>
            {outOfRuns ? "0 free runs remaining" : `${MAX_FREE_RUNS - runsUsed} of ${MAX_FREE_RUNS} free runs remaining`}
          </span>
        )}
      </div>

      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4">
          <label htmlFor="input" className="block text-sm font-medium text-slate-600 mb-2">
            Your input
          </label>
          <textarea
            id="input"
            rows={4}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste or type your input here..."
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 placeholder-slate-400 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            disabled={status === "loading" || outOfRuns}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="text-xs font-medium text-slate-500">Examples:</span>
            {examplePrompts.map((prompt) => (
              <button
                key={prompt.slice(0, 20)}
                type="button"
                onClick={() => setInput(prompt)}
                disabled={status === "loading" || outOfRuns}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
              >
                {prompt.slice(0, 40)}{prompt.length > 40 ? "…" : ""}
              </button>
            ))}
          </div>
        </div>

        {outOfRuns ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
            <p className="font-semibold text-amber-800">You&apos;ve used all your free runs!</p>
            <p className="mt-1 text-sm text-amber-700">Unlock unlimited runs with a Pro account.</p>
            <button
              type="button"
              disabled
              className="mt-4 rounded-xl bg-slate-300 px-6 py-2.5 text-sm font-semibold text-slate-500 cursor-not-allowed"
            >
              Upgrade to Pro (Coming Soon)
            </button>
          </div>
        ) : (
          <button
            type="submit"
            disabled={status === "loading"}
            className={`w-full rounded-xl py-3 text-base font-semibold text-white shadow-md transition-all hover:shadow-lg disabled:opacity-50 ${ctaBg} ${ctaHover}`}
          >
            {status === "loading" ? "Running…" : `Run ${agentName}`}
          </button>
        )}
      </form>

      {/* Loading skeleton */}
      {status === "loading" && (
        <div className="mt-6 space-y-3">
          <div className="flex items-center gap-2 text-slate-600">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />
            <span className="text-sm font-medium">Agent is thinking…</span>
          </div>
          <div className="animate-pulse space-y-2 rounded-2xl border border-slate-200 bg-white p-5">
            <div className="h-4 w-3/4 rounded-full bg-slate-200" />
            <div className="h-4 w-1/2 rounded-full bg-slate-200" />
            <div className="h-4 w-5/6 rounded-full bg-slate-200" />
            <div className="h-4 w-2/3 rounded-full bg-slate-200" />
          </div>
        </div>
      )}

      {/* Error */}
      {status === "error" && errorMessage && (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5">
          <p className="font-semibold text-red-800">Something went wrong</p>
          <p className="mt-1 text-sm text-red-700">{errorMessage}</p>
          <button
            type="button"
            onClick={() => { setStatus("idle"); setErrorMessage(null); }}
            className="mt-3 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700"
          >
            Try again
          </button>
        </div>
      )}

      {/* Result */}
      {status === "success" && result && (
        <div className="mt-6 space-y-4">
          <div className={`rounded-2xl border border-slate-200 border-l-4 ${accentBorder} bg-white p-5 shadow-sm`}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900">Result</h3>
              <div className="flex items-center gap-3">
                <button
                  onClick={async () => {
                    if (!result) return;
                    try {
                      await navigator.clipboard.writeText(result);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    } catch {
                      const textarea = document.createElement("textarea");
                      textarea.value = result;
                      textarea.style.position = "fixed";
                      textarea.style.opacity = "0";
                      document.body.appendChild(textarea);
                      textarea.select();
                      document.execCommand("copy");
                      document.body.removeChild(textarea);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
                >
                  {copied ? (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-3.5 w-3.5 text-emerald-600">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                      <span className="text-emerald-600">Copied!</span>
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-3.5 w-3.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
                      </svg>
                      Copy
                    </>
                  )}
                </button>
                <button
                  onClick={() => {
                    setStatus("idle");
                    setResult(null);
                    setInput(exampleInput);
                    setCopied(false);
                    localStorage.removeItem(`agentxchain_job_${agentSlug}`);
                  }}
                  className="text-xs text-slate-500 transition hover:text-slate-700"
                >
                  Clear &times;
                </button>
              </div>
            </div>
            <div className="mt-3">
              <ResultMarkdown text={result} />
            </div>
          </div>
          <p className="text-center">
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-sm font-semibold text-indigo-600 transition hover:text-indigo-700"
            >
              Try another agent
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
              </svg>
            </Link>
          </p>
        </div>
      )}
    </section>
  );
}

async function pollJob(jobId: string): Promise<string> {
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`/api/jobs/${jobId}`);
    if (!res.ok) throw new Error("Job not found");
    const job = await res.json();
    if (job.status === "completed") return job.result ?? "";
    if (job.status === "failed") throw new Error(job.error ?? "Run failed");
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Timed out waiting for result");
}
