import { NextResponse } from "next/server";
import { requireStatementUser, notFound } from "@/lib/statement-server";
import { loadStatementReview } from "@/lib/statement-review-data";

export const runtime = "nodejs";

// Everything the review screen needs in one read (see statement-review-data.ts).
// All reads go through the caller's own session, so RLS decides what comes back.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireStatementUser();
  if ("response" in auth) return auth.response;

  const { id } = await params;
  const data = await loadStatementReview(auth.ctx, id);
  if (!data) return notFound();

  return NextResponse.json(data);
}
