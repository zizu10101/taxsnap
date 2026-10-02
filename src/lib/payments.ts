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
// accounts. Blank/missing means "none" (null); an unknown or foreign id is a
// 404, and a credit card is a 400 - it can't receive a customer payment, so it
// is only ever valid as an expense's "Paid with" (see resolvePaidWithAccountId).
export type AccountResolution = { id: string | null } | { error: string; status: 400 | 404 };

export async function resolveBankAccountId(
  supabase: SupabaseClient<Database>,
  userId: string,
  value: unknown,
): Promise<AccountResolution> {
  if (value === undefined || value === null || value === "") return { id: null };
  if (typeof value !== "string") return { error: "Bank account not found.", status: 404 };

  const { data } = await supabase
    .from("bank_accounts")
    .select("id, account_type")
    .eq("id", value)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return { error: "Bank account not found.", status: 404 };
  if (data.account_type === "card") {
    return { error: "A credit card can't receive a payment - choose a bank account.", status: 400 };
  }
  return { id: data.id };
}

// "Paid with" on an expense: any of the caller's own accounts, bank or card,
// active or not (editing an old receipt keeps an account that was since
// deactivated). Same ownership re-check as above.
export async function resolvePaidWithAccountId(
  supabase: SupabaseClient<Database>,
  userId: string,
  value: unknown,
): Promise<AccountResolution> {
  if (value === undefined || value === null || value === "") return { id: null };
  if (typeof value !== "string") return { error: "Account not found.", status: 404 };

  const { data } = await supabase
    .from("bank_accounts")
    .select("id")
    .eq("id", value)
    .eq("user_id", userId)
    .maybeSingle();
  return data ? { id: data.id } : { error: "Account not found.", status: 404 };
}
