import { NextResponse } from "next/server";
import { getAgentBySlug } from "@/lib/data";
import { createJob, getJob, setJobStatus } from "@/lib/jobs";
import { runAgent } from "@/lib/llmRun";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const agent = getAgentBySlug(slug);
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  let body: { input?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body; expected { input: string }" },
      { status: 400 }
    );
  }

  const input =
    typeof body?.input === "string" ? body.input.trim() : "";
  if (!input) {
    return NextResponse.json(
      { error: "Missing or empty input" },
      { status: 400 }
    );
  }

  const job = createJob(slug, input);
  setJobStatus(job.id, "running");

  runAgent(agent, input)
    .then((result) => {
      setJobStatus(job.id, "completed", result);
    })
    .catch((err) => {
      setJobStatus(
        job.id,
        "failed",
        undefined,
        err instanceof Error ? err.message : "Run failed"
      );
    });

  return NextResponse.json({
    jobId: job.id,
    status: "running",
    message: "Job queued; poll GET /api/jobs/[jobId] for result.",
  });
}
