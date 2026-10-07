import { NextResponse } from "next/server";
import { requireStatementUser, monthlyCapFor, isUuid } from "@/lib/statement-server";
import { validateChunkPlan } from "@/lib/statement-chunks";
import { mapStatementDbError } from "@/lib/statement-errors";
import type { Json } from "@/lib/database.types";
import {
  alreadyImportedFor,
  releaseForReimport,
  restoreAfterFailedReimport,
} from "@/lib/statement-groups-server";
import { alreadyImportedMessage, capAllowsReimport, capNote } from "@/lib/statement-reimport";
import { STATEMENTS_HREF } from "@/lib/statement-routes";
import { logTiming, shortId, stopwatch } from "@/lib/statement-timing";

export const runtime = "nodejs";

// Starts a statement import: checks the plan's monthly cap, refuses a file that
// was already imported, and creates the draft with its page-chunk plan (the
// browser splits the file; nothing about the file itself is sent here).
//
// A file that was already saved is refused (ALREADY_IMPORTED) - with the details the app needs to be
// useful about it: when it was saved, how many of its expenses still exist, what a re-import would
// bring back, the cap, and a link to the Statements list. With `reimport_of` (the saved import's id)
// and a file that really is that import's file, the saved import is retired and a fresh draft starts
// in the same request: only when at least one line is free, and only if the monthly cap allows it (a
// re-import reads the statement again and is charged like any import). If starting then fails, the
// old import is put back, so nothing leaves the Statements list without a replacement.
//
// If an open draft already exists for the same file (a refresh, a second tab, a
// double-click) it is resumed instead of started again - and instead of billed
// again. Either way the response carries the chunk plan the draft actually has,
// which the browser must slice the file by.
export async function POST(request: Request) {
  const timer = stopwatch();
  const auth = await requireStatementUser();
  if ("response" in auth) return auth.response;
  const { ctx } = auth;
  timer.lap("auth");

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { account_id, file_sha256, page_count, chunks, reimport_of } = body;
  if (reimport_of !== undefined && !isUuid(reimport_of)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!isUuid(account_id)) {
    return NextResponse.json({ error: "Choose one of your credit cards.", code: "ACCOUNT_NOT_CARD" }, { status: 400 });
  }
  if (typeof file_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(file_sha256)) {
    return NextResponse.json({ error: "Invalid file fingerprint." }, { status: 400 });
  }
  const planError = validateChunkPlan(page_count, chunks);
  if (planError) return NextResponse.json({ error: planError }, { status: 400 });

  const cap = await monthlyCapFor(ctx);
  timer.lap("cap");

  // Re-import: validate against what is actually saved, never against the request's word.
  let retiredImportId: string | null = null;
  if (typeof reimport_of === "string") {
    const info = await alreadyImportedFor(ctx.supabase, ctx.user.id, file_sha256, cap);
    if (!info || info.import_id !== reimport_of) {
      return NextResponse.json(
        { error: "That isn't a saved import of this file.", code: "NOT_REIMPORTABLE" },
        { status: 409 },
      );
    }
    if (!info.can_reimport) {
      return NextResponse.json(
        {
          error: "Every line of this statement still has its expense, so there is nothing to bring back.",
          code: "NOTHING_TO_REIMPORT",
        },
        { status: 409 },
      );
    }
    if (!capAllowsReimport(info.cap)) {
      return NextResponse.json({ error: capNote(info.cap), code: "STATEMENT_CAP_REACHED" }, { status: 403 });
    }
    if (!(await releaseForReimport(ctx.admin, ctx.user.id, reimport_of, file_sha256))) {
      return NextResponse.json(
        { error: "That statement changed. Reload and try again.", code: "NOT_REIMPORTABLE" },
        { status: 409 },
      );
    }
    retiredImportId = reimport_of;
  }

  timer.lap("reimport");

  const { data: importId, error } = await ctx.admin.rpc("start_statement_import", {
    p_user_id: ctx.user.id,
    p_account_id: account_id,
    p_file_sha256: file_sha256,
    p_page_count: page_count as number,
    p_chunks: chunks as Json,
    p_monthly_cap: cap,
  });

  timer.lap("start_fn");
  let id = importId;
  let resumed = false;

  if (error) {
    // Starting failed after the saved import was retired: put it back.
    if (retiredImportId) await restoreAfterFailedReimport(ctx.admin, ctx.user.id, retiredImportId);

    // 23505 = the one-open-draft-per-file index: resume that draft.
    if (error.code !== "23505") {
      const mapped = mapStatementDbError(error);
      if (mapped.code === "ALREADY_IMPORTED") {
        const info = await alreadyImportedFor(ctx.supabase, ctx.user.id, file_sha256, cap);
        if (info) {
          return NextResponse.json(
            {
              error: alreadyImportedMessage(info),
              code: mapped.code,
              already_imported: info,
              statements_href: STATEMENTS_HREF,
            },
            { status: mapped.status },
          );
        }
      }
      return NextResponse.json({ error: mapped.message, code: mapped.code }, { status: mapped.status });
    }
    const { data: existing } = await ctx.supabase
      .from("statement_imports")
      .select("id")
      .eq("user_id", ctx.user.id)
      .eq("file_sha256", file_sha256)
      .eq("status", "draft")
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ error: "Couldn't start the import. Please try again." }, { status: 500 });
    }
    id = existing.id;
    resumed = true;
  }

  const { data: plan } = await ctx.supabase
    .from("statement_chunks")
    .select("chunk_no, page_from, page_to, status, attempts, error_code")
    .eq("import_id", id as string)
    .order("chunk_no", { ascending: true });

  timer.lap("plan");
  const timings = timer.snapshot();
  logTiming("start", {
    import: shortId(id as string),
    started_at: timer.startedAt(),
    finished_at: new Date().toISOString(),
    resumed,
    reimported: retiredImportId !== null,
    pages: page_count,
    chunks: plan?.length ?? 0,
    ...timings,
  });
  return NextResponse.json(
    { import_id: id, resumed, reimported: retiredImportId !== null, chunks: plan ?? [], timings },
    { status: resumed ? 200 : 201 },
  );
}
