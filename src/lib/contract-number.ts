import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// Starts at 100 (formatted CON-00100) - same reasoning as
// DOCUMENT_NUMBER_START in document-number.ts.
export const CONTRACT_NUMBER_START = 100;

// "max + 1" per user, same pattern as getNextDocumentNumber - the DB's
// own unique index (0033_contract_number.sql) is the safety net against
// a rare concurrent-insert race, not the primary mechanism.
export async function getNextContractNumber(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<number> {
  const { data } = await supabase
    .from("jobs")
    .select("contract_number")
    .eq("user_id", userId)
    .not("contract_number", "is", null)
    .order("contract_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data?.contract_number ?? CONTRACT_NUMBER_START - 1) + 1;
}

// "CON-00100" - zero-padded to 5 digits, unlike INV-1000/EST-1000 which
// aren't padded (their own numbers are already 4 digits by the time
// they'd need it).
export function formatContractNumber(contractNumber: number): string {
  return `CON-${String(contractNumber).padStart(5, "0")}`;
}
