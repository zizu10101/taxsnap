import { NextResponse } from "next/server";
import { getAccountantApiContext } from "@/lib/accountant-api";
import { getExpenseDetail, getRevenueDetail } from "@/lib/reports-query";

// Drill-down rows for the Reports page - same four types as the owner's
// /api/reports/detail (revenue, expenses, category, account), read-only.
export async function GET(request: Request) {
  const result = await getAccountantApiContext();
  if ("response" in result) return result.response;
  const { db } = result.ctx;

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (type === "revenue") {
    return NextResponse.json(await getRevenueDetail(db, from, to));
  }
  if (type === "expenses") {
    return NextResponse.json(await getExpenseDetail(db, from, to));
  }
  if (type === "category") {
    const category = searchParams.get("category");
    if (!category) {
      return NextResponse.json({ error: "category is required." }, { status: 400 });
    }
    return NextResponse.json(await getExpenseDetail(db, from, to, category));
  }
  if (type === "account") {
    const account = searchParams.get("account");
    if (!account) {
      return NextResponse.json({ error: "account is required." }, { status: 400 });
    }
    return NextResponse.json(await getExpenseDetail(db, from, to, undefined, account));
  }
  return NextResponse.json({ error: "Unknown report detail type." }, { status: 400 });
}
