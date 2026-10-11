import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";
import { getRevenueReport } from "@/lib/reports-query";

// Plain inclusive "YYYY-MM-DD" from/to (either optional) - see getRevenueReport.
export async function GET(request: Request) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const { searchParams } = new URL(request.url);
  const data = await getRevenueReport(
    result.supabase,
    result.user.id,
    searchParams.get("from"),
    searchParams.get("to"),
  );
  return NextResponse.json(data);
}
