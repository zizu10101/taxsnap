import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { recordActivation } from "@/lib/activation";
import { handleExpenseImport } from "@/lib/expense-import-server";
import { EXPENSE_IMPORT_MAX_BYTES } from "@/lib/expense-import";

// POST /api/receipts/import - the Expenses page's "Import CSV". Body { mode: "preview" | "apply",
// default_category, rows: [...] }: the dialog's already-mapped rows, never the file. The rules (row and
// size caps, every field, the tax math, duplicates, which rows save) all live in lib/expense-import*.ts and
// are enforced HERE. Any signed-in user, every tier, like adding an expense by hand. The user id is the
// session's. Nothing a person typed is logged: failures return fixed wording only.
export async function POST(request: Request) {
  const result = await requireUser();
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  const { supabase, user } = result;

  const text = await request.text().catch(() => null);
  if (text === null) return NextResponse.json({ error: "Could not read the request." }, { status: 400 });
  if (Buffer.byteLength(text, "utf8") > EXPENSE_IMPORT_MAX_BYTES) {
    return NextResponse.json({ error: "That import is over 1 MB. Split it into smaller files." }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Could not read the request." }, { status: 400 });
  }

  const { status, body: out } = await handleExpenseImport(supabase, user.id, body);
  if (status === 200 && typeof out.imported === "number" && out.imported > 0) {
    await recordActivation(supabase, user.id, "first_receipt_saved_at");
  }
  return NextResponse.json(out, { status });
}
