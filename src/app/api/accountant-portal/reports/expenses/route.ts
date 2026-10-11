import { NextResponse } from "next/server";
import { getAccountantApiContext } from "@/lib/accountant-api";
import { getExpensesReport } from "@/lib/reports-query";

export async function GET(request: Request) {
  const result = await getAccountantApiContext();
  if ("response" in result) return result.response;

  const { searchParams } = new URL(request.url);
  const data = await getExpensesReport(
    result.ctx.db,
    result.ctx.userId,
    searchParams.get("from"),
    searchParams.get("to"),
    { vendor: searchParams.get("vendor"), category: searchParams.get("category") },
  );
  return NextResponse.json(data);
}
