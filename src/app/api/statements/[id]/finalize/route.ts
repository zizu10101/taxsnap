import { NextResponse } from "next/server";
import { requireStatementUser, loadOwnImport, notFound } from "@/lib/statement-server";
import { mapStatementDbError } from "@/lib/statement-errors";
import { applyAutoMatches } from "@/lib/statement-match-server";

export const runtime = "nodejs";

// Called once every chunk is read. Fingerprints the lines, flags the ones that
// were already imported, then accepts the unambiguous receipt matches (ties and
// near matches are left for the user). Idempotent, so it is also what re-runs
// after a line's date or amount is edited - the auto-match step only ever fills
// in lines the user hasn't decided.
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

  const { data: lineCount, error } = await ctx.admin.rpc("finalize_statement_lines", {
    p_user_id: ctx.user.id,
    p_import_id: id,
  });
  if (error) {
    const mapped = mapStatementDbError(error);
    return NextResponse.json({ error: mapped.message, code: mapped.code }, { status: mapped.status });
  }

  const autoMatched = await applyAutoMatches(ctx, id);

  return NextResponse.json({ import_id: id, line_count: lineCount, auto_matched: autoMatched });
}
