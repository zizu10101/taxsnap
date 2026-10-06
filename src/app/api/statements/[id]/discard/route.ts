import { NextResponse } from "next/server";
import { requireStatementUser, loadOwnImport, notFound } from "@/lib/statement-server";
import { mapStatementDbError } from "@/lib/statement-errors";

export const runtime = "nodejs";

// Abandons a draft: its lines are deleted, and the row stays as a tombstone with
// its token counts (and still counts toward the month's cap if anything was read).
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireStatementUser();
  if ("response" in auth) return auth.response;
  const { ctx } = auth;

  const { id } = await params;
  const imp = await loadOwnImport(ctx, id);
  if (!imp) return notFound();

  const { error } = await ctx.admin.rpc("discard_statement_import", {
    p_user_id: ctx.user.id,
    p_import_id: id,
  });
  if (error) {
    const mapped = mapStatementDbError(error);
    return NextResponse.json({ error: mapped.message, code: mapped.code }, { status: mapped.status });
  }
  return NextResponse.json({ ok: true });
}
