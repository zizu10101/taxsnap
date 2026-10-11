import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";
import { getExpensesReport } from "@/lib/reports-query";

// The Expenses report. Plain inclusive "YYYY-MM-DD" from/to (either optional);
// optional `vendor` (a vendor key) and `category` filters that combine.
export async function GET(request: Request) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const { searchParams } = new URL(request.url);
  const data = await getExpensesReport(
    result.supabase,
    result.user.id,
    searchParams.get("from"),
    searchParams.get("to"),
    { vendor: searchParams.get("vendor"), category: searchParams.get("category") },
  );
  return NextResponse.json(data);
}
