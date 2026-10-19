import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";

// Activation timestamps on the profile, so "did a new account send an invoice
// or save a receipt within 7 days of signing up" can be measured. Each is set
// ONCE (the first time) - the .is(..., null) guard means a later event can
// never overwrite it. Best-effort: a failure here must never fail the save or
// send that triggered it, so errors are swallowed and logged without any
// user data.
export type ActivationColumn = "first_invoice_sent_at" | "first_receipt_saved_at";

export async function recordActivation(
  supabase: SupabaseClient<Database>,
  userId: string,
  column: ActivationColumn,
): Promise<void> {
  try {
    const now = new Date().toISOString();
    const patch =
      column === "first_invoice_sent_at" ? { first_invoice_sent_at: now } : { first_receipt_saved_at: now };
    const { error } = await supabase
      .from("profiles")
      .update(patch)
      .eq("id", userId)
      .is(column, null);
    if (error) console.error(`recordActivation(${column}) failed:`, error.message);
  } catch (err) {
    console.error(`recordActivation(${column}) threw:`, err instanceof Error ? err.message : "unknown");
  }
}
