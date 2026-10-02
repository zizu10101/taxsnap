import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";
import { getReportsData } from "@/lib/reports-query";

// Pro-only, like Overview. `from`/`to` are plain inclusive "YYYY-MM-DD"
// strings - see getReportsData.
export async function GET(request: Request) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const { searchParams } = new URL(request.url);
  const data = await getReportsData(
    result.supabase,
    searchParams.get("from"),
    searchParams.get("to"),
  );
  return NextResponse.json(data);
}
