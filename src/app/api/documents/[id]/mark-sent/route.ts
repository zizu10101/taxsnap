import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { recordActivation } from "@/lib/activation";
import { markInvoiceShared } from "@/lib/mark-invoice-sent";

// Called by the Send menu after a Download or a Share succeeds (those happen in the
// browser, so the server would not otherwise know). Body `{ mark_sent: true }` (the share
// sheet) also moves a DRAFT invoice to Sent via markInvoiceShared - never a downgrade, never
// an estimate. A plain Download only records the first-invoice-sent activation timestamp.
export async function POST(
  request: Request,
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

  const body = await request.json().catch(() => null);
  if (body?.mark_sent === true) {
    const { markedSent } = await markInvoiceShared(supabase, user.id, doc);
    return NextResponse.json({ success: true, marked_sent: markedSent });
  }
  if (doc.type === "invoice") await recordActivation(supabase, user.id, "first_invoice_sent_at");
  return NextResponse.json({ success: true, marked_sent: false });
}
