import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { STATEMENT_STALE_DRAFT_DAYS } from "@/lib/statement-config";

export const runtime = "nodejs";

// Daily Vercel Cron (see vercel.json). Deletes statement-import drafts nobody has
// touched for STATEMENT_STALE_DRAFT_DAYS: their lines are removed and the row is
// kept as a tombstone, so the monthly cap and token-cost audit still see it.
// Committed imports are never touched.
//
// Vercel sends `Authorization: Bearer <CRON_SECRET>`; with no secret configured
// the route refuses everything rather than running open.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await createAdminClient().rpc("purge_stale_statement_drafts", {
    p_days: STATEMENT_STALE_DRAFT_DAYS,
  });
  if (error) {
    console.error("[cron] purge-statement-drafts failed", { code: error.code });
    return NextResponse.json({ error: "Purge failed" }, { status: 500 });
  }
  return NextResponse.json({ purged: data });
}
