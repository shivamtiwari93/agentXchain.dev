import { NextResponse } from "next/server";
import { getAgentBySlug } from "@/lib/data";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const agent = getAgentBySlug(slug);
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }
  return NextResponse.json(agent);
}
