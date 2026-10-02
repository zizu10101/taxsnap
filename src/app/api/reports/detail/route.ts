import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";
import { getExpenseDetail, getRevenueDetail } from "@/lib/reports-query";

// Drill-down rows for the Reports page, fetched when a line is expanded:
//   ?type=revenue            - payments behind the P&L's revenue
//   ?type=expenses           - receipts behind the P&L's expenses
//   ?type=category&category= - receipts behind one Expenses by Category row
// all within the optional inclusive "YYYY-MM-DD" from/to.
export async function GET(request: Request) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase } = result;

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (type === "revenue") {
    return NextResponse.json(await getRevenueDetail(supabase, from, to));
  }
  if (type === "expenses") {
    return NextResponse.json(await getExpenseDetail(supabase, from, to));
  }
  if (type === "category") {
    const category = searchParams.get("category");
    if (!category) {
      return NextResponse.json({ error: "category is required." }, { status: 400 });
    }
    return NextResponse.json(await getExpenseDetail(supabase, from, to, category));
  }
  return NextResponse.json({ error: "Unknown report detail type." }, { status: 400 });
}
