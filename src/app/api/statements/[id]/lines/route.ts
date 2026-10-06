import { NextResponse } from "next/server";
import { requireStatementUser, loadOwnImport, loadCategoryOptions, isUuid, notFound } from "@/lib/statement-server";
import { buildLineUpdate, type LinePatch } from "@/lib/statement-line-patch";
import { rankCandidates } from "@/lib/statement-matching";
import { resolvePaidWithAccountId } from "@/lib/payments";
import { mapStatementDbError } from "@/lib/statement-errors";
import { STATEMENT_MAX_LINES } from "@/lib/statement-config";

export const runtime = "nodejs";

// Applies one edit to one or many lines of a draft import - the review screen's
// only write. `line_ids` lets "accept every suggested category" be a single call;
// with one id, a rejected edit is a 400 with the reason, with several it is
// skipped and counted. Every id is re-checked to belong to this import and this
// user, and everything the line is changed to is validated first
// (statement-line-patch.ts), so the database constraints are a backstop.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireStatementUser();
  if ("response" in auth) return auth.response;
  const { ctx } = auth;

  const { id } = await params;
  const imp = await loadOwnImport(ctx, id);
  if (!imp) return notFound();
  if (imp.status !== "draft") {
    return NextResponse.json({ error: "This import is no longer open.", code: "IMPORT_NOT_OPEN" }, { status: 409 });
  }

  let body: { line_ids?: unknown; patch?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const ids = body.line_ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > STATEMENT_MAX_LINES || !ids.every(isUuid)) {
    return NextResponse.json({ error: "line_ids must list the lines to change." }, { status: 400 });
  }
  if (!body.patch || typeof body.patch !== "object") {
    return NextResponse.json({ error: "patch is required." }, { status: 400 });
  }
  const patch = body.patch as LinePatch;

  const { data: lines } = await ctx.supabase
    .from("statement_lines")
    .select("*")
    .eq("import_id", id)
    .eq("user_id", ctx.user.id)
    .in("id", ids as string[]);
  if (!lines || lines.length !== new Set(ids as string[]).size) return notFound();

  const categories = await loadCategoryOptions(ctx);
  const today = new Date().toISOString().slice(0, 10);

  // An account id is the same for every line in the edit: verify it once.
  if (patch.paid_with_account_id) {
    const account = await resolvePaidWithAccountId(ctx.supabase, ctx.user.id, patch.paid_with_account_id);
    if ("error" in account) return NextResponse.json({ error: account.error }, { status: account.status });
  }

  let updated = 0;
  let skipped = 0;
  let needsRefingerprint = false;
  let firstError: { error: string; status: number; code?: string } | null = null;

  for (const line of lines) {
    const outcome = buildLineUpdate(line, patch, categories, today);
    if (!outcome.ok) {
      skipped += 1;
      firstError ??= { error: outcome.error, status: 400 };
      continue;
    }
    if ("skip" in outcome) {
      skipped += 1;
      continue;
    }

    // A matched receipt must be the user's own, a real receipt, and one of the
    // candidates the matcher would offer for this line - not any receipt.
    if (outcome.checkReceiptId) {
      const { data: receipt } = await ctx.supabase
        .from("receipts")
        .select("*")
        .eq("id", outcome.checkReceiptId)
        .eq("user_id", ctx.user.id)
        .maybeSingle();
      const isCandidate =
        !!receipt &&
        !receipt.from_statement &&
        receipt.total_amount > 0 &&
        rankCandidates(
          { id: line.id, date: outcome.update.txn_date ?? line.txn_date, amount: outcome.update.amount ?? line.amount },
          [{ id: receipt.id, date: receipt.transaction_date, amount: receipt.total_amount }],
        ).length > 0;
      if (!isCandidate) {
        skipped += 1;
        firstError ??= { error: "That receipt isn't a match for this line.", status: 400 };
        continue;
      }
    }

    const { error } = await ctx.admin
      .from("statement_lines")
      .update(outcome.update)
      .eq("id", line.id)
      .eq("user_id", ctx.user.id)
      .eq("import_id", id);
    if (error) {
      const mapped = mapStatementDbError(error);
      skipped += 1;
      firstError ??= { error: mapped.message, status: mapped.status, code: mapped.code };
      continue;
    }
    updated += 1;
    if (outcome.refingerprint) needsRefingerprint = true;
  }

  if (needsRefingerprint) {
    // The date or amount changed, so "nth occurrence" fingerprints and the
    // already-imported flags have to be recomputed.
    await ctx.admin.rpc("finalize_statement_lines", { p_user_id: ctx.user.id, p_import_id: id });
  }
  if (updated > 0) {
    await ctx.admin
      .from("statement_imports")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", ctx.user.id);
  }

  if (lines.length === 1 && firstError) {
    return NextResponse.json({ error: firstError.error, code: firstError.code }, { status: firstError.status });
  }
  return NextResponse.json({ updated, skipped, ...(firstError && { note: firstError.error }) });
}
