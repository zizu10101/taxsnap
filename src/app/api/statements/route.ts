import { NextResponse } from "next/server";
import { requireStatementUser, monthlyCapFor, isUuid } from "@/lib/statement-server";
import { validateChunkPlan } from "@/lib/statement-chunks";
import { mapStatementDbError } from "@/lib/statement-errors";
import type { Json } from "@/lib/database.types";

export const runtime = "nodejs";

// Starts a statement import: checks the plan's monthly cap, refuses a file that
// was already imported, and creates the draft with its page-chunk plan (the
// browser splits the file; nothing about the file itself is sent here).
//
// If an open draft already exists for the same file (a refresh, a second tab, a
// double-click) it is resumed instead of started again - and instead of billed
// again. Either way the response carries the chunk plan the draft actually has,
// which the browser must slice the file by.
export async function POST(request: Request) {
  const auth = await requireStatementUser();
  if ("response" in auth) return auth.response;
  const { ctx } = auth;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { account_id, file_sha256, page_count, chunks } = body;
  if (!isUuid(account_id)) {
    return NextResponse.json({ error: "Choose one of your credit cards.", code: "ACCOUNT_NOT_CARD" }, { status: 400 });
  }
  if (typeof file_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(file_sha256)) {
    return NextResponse.json({ error: "Invalid file fingerprint." }, { status: 400 });
  }
  const planError = validateChunkPlan(page_count, chunks);
  if (planError) return NextResponse.json({ error: planError }, { status: 400 });

  const cap = await monthlyCapFor(ctx);
  const { data: importId, error } = await ctx.admin.rpc("start_statement_import", {
    p_user_id: ctx.user.id,
    p_account_id: account_id,
    p_file_sha256: file_sha256,
    p_page_count: page_count as number,
    p_chunks: chunks as Json,
    p_monthly_cap: cap,
  });

  let id = importId;
  let resumed = false;

  if (error) {
    // 23505 = the one-open-draft-per-file index: resume that draft.
    if (error.code !== "23505") {
      const mapped = mapStatementDbError(error);
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

  return NextResponse.json({ import_id: id, resumed, chunks: plan ?? [] }, { status: resumed ? 200 : 201 });
}
