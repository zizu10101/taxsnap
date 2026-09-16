import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, DocumentType } from "@/lib/database.types";

// Starts at 1000 rather than 1 so a brand-new account's first invoice
// doesn't read as "this business just started" to a client.
export const DOCUMENT_NUMBER_START = 1000;

// Separate series per document type (INV-1000.../EST-1000...), not one
// shared counter - matches how real invoicing tools number quotes and
// invoices independently. "max + 1" rather than a stored per-user counter
// row: simpler, and a document is never deleted then re-numbered in a way
// that would make this drift (see 0026_document_number.sql's unique index
// for the safety net against a rare concurrent-insert race).
export async function getNextDocumentNumber(
  supabase: SupabaseClient<Database>,
  userId: string,
  type: DocumentType,
): Promise<number> {
  const { data } = await supabase
    .from("documents")
    .select("document_number")
    .eq("user_id", userId)
    .eq("type", type)
    .order("document_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data?.document_number ?? DOCUMENT_NUMBER_START - 1) + 1;
}

// "INV-1000" / "EST-1000" - replaces the old "#" + first 8 chars of the
// row's uuid display everywhere a document's number is shown.
export function formatDocumentNumber(type: DocumentType, documentNumber: number): string {
  const prefix = type === "invoice" ? "INV" : "EST";
  return `${prefix}-${documentNumber}`;
}
