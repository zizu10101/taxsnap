import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { recordActivation } from "@/lib/activation";

// Called by the Send menu after a Download / Share succeeds (those happen in the
// browser, so the server would not otherwise know). Only records the owner's
// first-invoice-sent activation timestamp; it never touches the document or its
// status (sending does not change status).
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;
  const { id } = await params;

  const { data: doc } = await supabase
    .from("documents")
    .select("id, type")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!doc) return NextResponse.json({ error: "Document not found." }, { status: 404 });

  if (doc.type === "invoice") await recordActivation(supabase, user.id, "first_invoice_sent_at");
  return NextResponse.json({ success: true });
}
