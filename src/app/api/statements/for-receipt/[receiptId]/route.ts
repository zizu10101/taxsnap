import { NextResponse } from "next/server";
import { requireStatementUser, isUuid } from "@/lib/statement-server";
import { findStatementForReceipt } from "@/lib/statement-groups-server";

export const runtime = "nodejs";

// Which saved statement created (or was matched to) this expense - the expense drawer's "From
// statement" link. `statement` is null for an ordinary receipt. Allowlist-only like the rest.
export async function GET(_request: Request, { params }: { params: Promise<{ receiptId: string }> }) {
  const auth = await requireStatementUser();
  if ("response" in auth) return auth.response;
  const { ctx } = auth;

  const { receiptId } = await params;
  if (!isUuid(receiptId)) return NextResponse.json({ statement: null });
  const statement = await findStatementForReceipt(ctx.supabase, ctx.user.id, receiptId);
  return NextResponse.json({ statement });
}
