import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { handleExpenseImportUndo } from "@/lib/expense-import-server";

// POST /api/receipts/import/undo - body { ids }: removes the expenses an import just created (the ids the
// import answered with). Owner's rows only, image-less rows only; see handleExpenseImportUndo.
export async function POST(request: Request) {
  const result = await requireUser();
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  const body = await request.json().catch(() => null);
  const { status, body: out } = await handleExpenseImportUndo(result.supabase, result.user.id, body);
  return NextResponse.json(out, { status });
}
