import { NextResponse } from "next/server";
import { AGENTS } from "@/lib/data";

export async function GET() {
  return NextResponse.json(AGENTS);
}
