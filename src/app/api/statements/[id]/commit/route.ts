import { NextResponse } from "next/server";
import { requireStatementUser, loadOwnImport, notFound } from "@/lib/statement-server";
import { mapStatementDbError } from "@/lib/statement-errors";
import { reconcileStatement } from "@/lib/statement-reconcile";
import { BANK_CHARGES_CATEGORY } from "@/lib/statement-lines";

export const runtime = "nodejs";

// Saves the reviewed import: matched lines are linked to their receipts, new
// expenses are created (HST 0, flagged "No receipt"), the rest are skipped - all
// in one database transaction (commit_statement_import), so it either fully
// happens or doesn't.
//
// The statement-total check is recomputed here from the stored lines; whether
// the lines add up is never taken from the browser. Only the user's explicit
// acknowledgement of a mismatch is.
export async function POST(
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

  const body = (await request.json().catch(() => ({}))) as { acknowledge_reconcile?: unknown };
  const acknowledged = body.acknowledge_reconcile === true;

  const { data: lines } = await ctx.supabase
    .from("statement_lines")
    .select("amount, kind, resolution, category")
    .eq("import_id", id)
    .eq("user_id", ctx.user.id);
  if (!lines || lines.length === 0) {
    return NextResponse.json({ error: "There are no lines to save.", code: "NO_LINES" }, { status: 409 });
  }

  const reconcile = reconcileStatement({
    lines,
    opening_balance: imp.opening_balance,
    closing_balance: imp.closing_balance,
    statement_total: imp.statement_total,
    statement_total_kind: imp.statement_total_kind,
  });

  // "Bank charges" is offered to every importing user but isn't in the global
  // category list, so the first statement that uses it creates it as the
  // owner's own category - otherwise the next edit of that expense would turn
  // it into "Other" (resolveCategory only knows defaults + the owner's own).
  const usesBankCharges = lines.some(
    (l) => l.resolution === "new_expense" && l.category?.toLowerCase() === BANK_CHARGES_CATEGORY.toLowerCase(),
  );
  if (usesBankCharges) {
    const { data: own } = await ctx.supabase
      .from("expense_categories")
      .select("name")
      .eq("user_id", ctx.user.id);
    const has = (own ?? []).some((c) => c.name.trim().toLowerCase() === BANK_CHARGES_CATEGORY.toLowerCase());
    if (!has) {
      await ctx.admin
        .from("expense_categories")
        .insert({ user_id: ctx.user.id, name: BANK_CHARGES_CATEGORY });
    }
  }

  const { data: result, error } = await ctx.admin.rpc("commit_statement_import", {
    p_user_id: ctx.user.id,
    p_import_id: id,
    p_reconcile_diff: reconcile.status === "no_total" ? null : reconcile.diff,
    p_reconcile_acknowledged: acknowledged,
  });
  if (error) {
    const mapped = mapStatementDbError(error);
    return NextResponse.json({ error: mapped.message, code: mapped.code }, { status: mapped.status });
  }

  return NextResponse.json({ result });
}
