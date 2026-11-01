import { NextResponse } from "next/server";
import { requireStatementUser } from "@/lib/statement-server";
import { applyAutoMatches } from "@/lib/statement-match-server";
import { handleStatementCsv } from "@/lib/statement-csv-server";
import { STATEMENT_CSV_MAX_BYTES } from "@/lib/statement-csv";

export const runtime = "nodejs";

// POST /api/statements/csv - "Import CSV" in the card statement import. Body { mode: "preview" | "apply",
// account_id, file_sha256, layout, convention, rows: [...], period_start?, period_end?, opening_balance?,
// closing_balance? }: the dialog's already-mapped rows, never the file. Behind the same allowlist as every
// other /api/statements route (requireStatementUser: 401 signed out, 404 when the user isn't on it), and the
// handler checks it again. The user id is the session's. Nothing a person typed is logged.
export async function POST(request: Request) {
  const auth = await requireStatementUser();
  if ("response" in auth) return auth.response;
  const { ctx } = auth;

  const text = await request.text().catch(() => null);
  if (text === null) return NextResponse.json({ error: "Could not read the request." }, { status: 400 });
  // The rows are a re-encoding of the file (plus the field names), so allow the file's own limit with headroom.
  if (Buffer.byteLength(text, "utf8") > STATEMENT_CSV_MAX_BYTES * 2) {
    return NextResponse.json({ error: "That file is too large. Split it into smaller files." }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Could not read the request." }, { status: 400 });
  }

  const { status, body: out } = await handleStatementCsv(
    { read: ctx.supabase, admin: ctx.admin, matchLines: (importId) => applyAutoMatches(ctx, importId) },
    ctx.user.id,
    body,
  );
  return NextResponse.json(out, { status });
}
