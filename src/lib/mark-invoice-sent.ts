import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import { recordActivation } from "./activation.ts";

// Sharing an invoice - copying its link, emailing it, handing the PDF to the share sheet
// (WhatsApp, SMS, ...) - means it has been sent: a DRAFT invoice becomes SENT. The update
// is guarded by `status = 'draft'` in the query itself, so Sent, Partial and Paid are never
// touched (no downgrade, ever) and an estimate is never touched. Returns whether the status
// really changed, so the caller can tell the owner. Also records the first-invoice-sent
// activation timestamp (set once). Content lock follows from the status: a sent invoice's
// lines are locked, and one with an opened payment link can't go back to draft (see
// draftBlockedMessage in stripe-payment-lock.ts).
export async function markInvoiceShared(
  supabase: SupabaseClient<Database>,
  userId: string,
  doc: { id: string; type: string },
): Promise<{ markedSent: boolean }> {
  if (doc.type !== "invoice") return { markedSent: false };
  await recordActivation(supabase, userId, "first_invoice_sent_at");
  const { data, error } = await supabase
    .from("documents")
    .update({ status: "sent", updated_at: new Date().toISOString() })
    .eq("id", doc.id)
    .eq("user_id", userId)
    .eq("type", "invoice")
    .eq("status", "draft")
    .select("id");
  if (error) {
    console.error("markInvoiceShared failed:", error.message);
    return { markedSent: false };
  }
  return { markedSent: (data ?? []).length > 0 };
}
