import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import { selectAll } from "./select-all.ts";
import { unpaidInvoicesFrom, type InvoiceRow, type UnpaidInvoice } from "./statement-invoice-hints.ts";

// Reads the owner's unpaid invoices ONCE (every row, paged past the 1000-row cap) through their own session (RLS) and
// reduces them to what the hint shows. Read-only. Called only for a bank statement that has money-in lines.
export async function loadUnpaidInvoices(db: SupabaseClient<Database>, userId: string): Promise<UnpaidInvoice[]> {
  const { rows } = await selectAll<InvoiceRow>(
    () =>
      db
        .from("documents")
        .select("id, type, status, document_number, issue_date, total_amount, client:clients(name, is_sample), payments(amount)")
        .eq("user_id", userId)
        .eq("type", "invoice")
        .in("status", ["sent", "partial"])
        .order("issue_date", { ascending: true })
        .order("id", { ascending: true }) as unknown as import("./select-all.ts").RangeQuery<InvoiceRow>,
  );
  return unpaidInvoicesFrom(rows);
}
