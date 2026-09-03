import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";
import { getExpenseOverviewData } from "@/lib/expense-overview-query";

// General-business analogue of GET /api/commission/overview - see
// getExpenseOverviewData for the actual query/aggregation logic, shared
// with the Overview page's own initial server render.
export async function GET(request: Request) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase } = result;

  const { searchParams } = new URL(request.url);
  // Plain inclusive "YYYY-MM-DD" strings, not UTC instants - see
  // getExpenseOverviewData's own comment for why transaction_date (a
  // `date` column) uses a different convention than commission_entries'
  // timestamptz-based from/to.
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const data = await getExpenseOverviewData(supabase, from, to);
  return NextResponse.json(data);
}
