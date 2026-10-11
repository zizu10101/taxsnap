import { NextResponse } from "next/server";
import { getAccountantApiContext } from "@/lib/accountant-api";
import { getRevenueReport } from "@/lib/reports-query";

export async function GET(request: Request) {
  const result = await getAccountantApiContext();
  if ("response" in result) return result.response;

  const { searchParams } = new URL(request.url);
  const data = await getRevenueReport(
    result.ctx.db,
    result.ctx.userId,
    searchParams.get("from"),
    searchParams.get("to"),
  );
  return NextResponse.json(data);
}
