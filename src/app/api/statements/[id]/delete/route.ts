import { NextResponse } from "next/server";
import { requireStatementUser, isUuid, notFound } from "@/lib/statement-server";
import { applyStatementDelete, previewStatementDelete } from "@/lib/statement-groups-server";
import { cleanExpectation } from "@/lib/statement-delete";

export const runtime = "nodejs";

// "Delete statement" for a SAVED import, in two steps the owner confirms:
//   {mode:"preview"}                  what would be deleted / kept / unlinked - nothing is written
//   {mode:"apply", expect}            `expect` is what the preview showed; if anything changed since
//                                      (a receipt attached, an expense deleted by hand) nothing is
//                                      written and the fresh counts come back (409 STALE_PREVIEW)
// It deletes only the statement's expenses that have NO receipt attached, never a matched receipt,
// and marks the import discarded last so the same file can be uploaded again. Never automatic.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStatementUser();
  if ("response" in auth) return auth.response;
  const { ctx } = auth;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const body = (await request.json().catch(() => null)) as { mode?: unknown; expect?: unknown } | null;
  try {
    if (body?.mode === "preview") {
      const result = await previewStatementDelete(ctx.supabase, ctx.user.id, id);
      return NextResponse.json(result.body, { status: result.status });
    }
    if (body?.mode === "apply") {
      const expect = cleanExpectation(body.expect);
      if (!expect) return NextResponse.json({ error: "Preview the delete first." }, { status: 400 });
      const result = await applyStatementDelete(ctx.supabase, ctx.admin, ctx.user.id, id, expect);
      return NextResponse.json(result.body, { status: result.status });
    }
    return NextResponse.json({ error: "mode must be preview or apply." }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Something went wrong. Nothing more was changed - try again." }, { status: 500 });
  }
}
