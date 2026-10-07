import { NextResponse } from "next/server";
import { requireStatementUser, notFound } from "@/lib/statement-server";
import { loadStatementReview } from "@/lib/statement-review-data";
import { logTiming, shortId, stopwatch } from "@/lib/statement-timing";

export const runtime = "nodejs";

// Everything the review screen needs in one read (see statement-review-data.ts).
// All reads go through the caller's own session, so RLS decides what comes back.
//
// This is what runs after EVERY edit on the review screen (the screen reloads), and it includes the
// receipt re-match, so it is timed stage by stage and logged as a [statement-timing] "review-load"
// line (trigger: "reload"), with how many receipts the re-match had to read. `timings` is also
// returned with the data.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const timer = stopwatch();
  const auth = await requireStatementUser();
  if ("response" in auth) return auth.response;
  timer.lap("auth");

  const { id } = await params;
  const data = await loadStatementReview(auth.ctx, id, timer);
  if (!data) return notFound();

  const timings = timer.snapshot();
  logTiming("review-load", {
    import: shortId(id),
    trigger: "reload",
    started_at: timer.startedAt(),
    finished_at: new Date().toISOString(),
    lines: data.lines.length,
    ...timings,
  });
  return NextResponse.json({ ...data, timings });
}
