import { NextResponse } from "next/server";
import { getAccountantApiContext } from "@/lib/accountant-api";
import { getJobSummary } from "@/lib/reports-query";

// Job Summary over its own, optional date range (no from/to = all time).
export async function GET(request: Request) {
  const result = await getAccountantApiContext();
  if ("response" in result) return result.response;

  const { searchParams } = new URL(request.url);
  const data = await getJobSummary(result.ctx.db, searchParams.get("from"), searchParams.get("to"));
  return NextResponse.json(data);
}
