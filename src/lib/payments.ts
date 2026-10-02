import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, DocumentStatus } from "./database.types";

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Recomputes a document's status from its payment total rather than
// trusting the client - a deposit only ever brings it to "partial", and
// it only reaches "paid" once payments cover the full total. Shared by
// every route that inserts a payment (single-document and, since the
// contract-level bulk allocator, multi-document at once).
export function statusFromPaid(paid: number, total: number): DocumentStatus {
  if (paid <= 0) return "sent";
  if (paid >= total) return "paid";
  return "partial";
}

// "Deposited to" is optional. A FK alone only proves the account exists, not
// that it's this user's (same reasoning as job_id on documents/hours), so any
// id that came from the request is re-verified against the caller's own
// accounts. Blank/missing means "none" (null); an unknown or foreign id is an
// error the route turns into a 404.
export async function resolveBankAccountId(
  supabase: SupabaseClient<Database>,
  userId: string,
  value: unknown,
): Promise<{ id: string | null } | { error: string }> {
  if (value === undefined || value === null || value === "") return { id: null };
  if (typeof value !== "string") return { error: "Bank account not found." };

  const { data } = await supabase
    .from("bank_accounts")
    .select("id")
    .eq("id", value)
    .eq("user_id", userId)
    .maybeSingle();
  return data ? { id: data.id } : { error: "Bank account not found." };
}
