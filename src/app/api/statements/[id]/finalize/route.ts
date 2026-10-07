import { NextResponse } from "next/server";
import { requireStatementUser, loadOwnImport, notFound } from "@/lib/statement-server";
import { mapStatementDbError } from "@/lib/statement-errors";
import { applyAutoMatches } from "@/lib/statement-match-server";
import { cleanClientTimings, logTiming, shortId, stopwatch } from "@/lib/statement-timing";

export const runtime = "nodejs";

// Called once every chunk is read. Fingerprints the lines, flags the ones that
// were already imported, then accepts the unambiguous receipt matches (ties and
// near matches are left for the user). Idempotent, so it is also what re-runs
// after a line's date or amount is edited - the auto-match step only ever fills
// in lines the user hasn't decided.
//
// Timed stage by stage (the fingerprint function, then the auto-match with its own receipt-window
// sub-stages) and logged as one [statement-timing] line. The browser may send its own side of the
// import in the body ({client: {...}}: opening + hashing the file, upload and network time per
// chunk); that is clamped to plain numbers and logged as a second line, so one import's whole
// picture - browser and server - is in the log. No statement content is ever logged.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const timer = stopwatch();
  const auth = await requireStatementUser();
  if ("response" in auth) return auth.response;
  const { ctx } = auth;

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { client?: unknown } | null;
  const imp = await loadOwnImport(ctx, id);
  timer.lap("load");
  if (!imp) return notFound();

  const { data: lineCount, error } = await ctx.admin.rpc("finalize_statement_lines", {
    p_user_id: ctx.user.id,
    p_import_id: id,
  });
  timer.lap("finalize_fn");
  if (error) {
    const mapped = mapStatementDbError(error);
    return NextResponse.json({ error: mapped.message, code: mapped.code }, { status: mapped.status });
  }

  const autoMatched = await applyAutoMatches(ctx, id, timer);

  const timings = { ...timer.snapshot(), auto_matched: autoMatched };
  logTiming("finalize", {
    import: shortId(id),
    started_at: timer.startedAt(),
    finished_at: new Date().toISOString(),
    lines: lineCount,
    ...timings,
  });
  const client = cleanClientTimings(body?.client);
  if (client) logTiming("client-summary", { import: shortId(id), ...client });

  return NextResponse.json({ import_id: id, line_count: lineCount, auto_matched: autoMatched, timings });
}
