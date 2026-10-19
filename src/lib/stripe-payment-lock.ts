import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";

export const STRIPE_PAYMENT_LOCKED_MESSAGE =
  "This payment was made online by card, so it can't be edited or deleted here. Refunds are made in your Stripe Dashboard.";

export const DRAFT_AFTER_SESSION_MESSAGE =
  "This invoice has been opened for online payment, so it can't go back to draft.";

// A payment that arrived through Stripe is a record of real card money: the
// payment routes refuse to change or remove it. Returns the refusal message, or
// null when the payment is an ordinary manual one (or does not exist - the route's
// own update/delete then simply matches nothing).
export async function stripePaymentLockMessage(
  supabase: SupabaseClient<Database>,
  documentId: string,
  paymentId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("payments")
    .select("source")
    .eq("id", paymentId)
    .eq("document_id", documentId)
    .maybeSingle();
  return data && data.source !== "manual" ? STRIPE_PAYMENT_LOCKED_MESSAGE : null;
}

// Once a Checkout Session was opened for an invoice it must stay "sent" or later:
// sending it back to draft would let the content change under a live payment link.
export function draftBlockedMessage(
  nextStatus: unknown,
  existing: { status: string; online_session_opened_at: string | null },
): string | null {
  return nextStatus === "draft" && existing.status !== "draft" && existing.online_session_opened_at
    ? DRAFT_AFTER_SESSION_MESSAGE
    : null;
}
