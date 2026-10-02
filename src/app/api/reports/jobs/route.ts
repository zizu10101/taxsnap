import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";
import { getJobSummary } from "@/lib/reports-query";

// Job Summary over its own, optional date range (no from/to = all time).
// Plain inclusive "YYYY-MM-DD" strings - see getJobSummary.
export async function GET(request: Request) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const { searchParams } = new URL(request.url);
  const data = await getJobSummary(
    result.supabase,
    searchParams.get("from"),
    searchParams.get("to"),
  );
  return NextResponse.json(data);
}
