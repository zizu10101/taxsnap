import { NextResponse } from "next/server";
import { getAccountantApiContext } from "@/lib/accountant-api";
import { getReportsData } from "@/lib/reports-query";

// Read-only. The same getReportsData the owner's Reports page uses, run
// through the scoped reader. from/to are plain inclusive "YYYY-MM-DD" strings.
export async function GET(request: Request) {
  const result = await getAccountantApiContext();
  if ("response" in result) return result.response;

  const { searchParams } = new URL(request.url);
  const data = await getReportsData(result.ctx.db, searchParams.get("from"), searchParams.get("to"));
  return NextResponse.json(data);
}
