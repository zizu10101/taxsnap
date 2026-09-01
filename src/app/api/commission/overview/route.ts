import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";
import { getCommissionOverviewData } from "@/lib/commission-overview-query";

// Shop-wide rollup across every stylist - no stylist_id filter anywhere
// here, unlike GET /api/commission-entries and GET /api/payouts. See
// getCommissionOverviewData for the actual query/aggregation logic,
// shared with the Overview page's own initial server render.
export async function GET(request: Request) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase } = result;

  const { searchParams } = new URL(request.url);
  // Full UTC instants from rangeToUtcBounds, same convention as every
  // other date-filtered route - see GET /api/commission-entries for why a
  // bare "YYYY-MM-DD" can't be compared directly against a timestamptz.
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const data = await getCommissionOverviewData(supabase, from, to);
  return NextResponse.json(data);
}
