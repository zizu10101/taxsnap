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

// Separate, job-scoped counter from document_number above - a progress
// draw gets both: its real sequential invoice number (INV-1004, for
// accounting continuity) and a small "Draw #1/#2/#3" number scoped to
// just this job's draws, starting at 1 (not 1000 - a draw number is a
// human-friendly progress counter shown to the client, not an invoice
// identifier that needs to look established).
export async function getNextDrawNumber(
  supabase: SupabaseClient<Database>,
  jobId: string,
): Promise<number> {
  const { data } = await supabase
    .from("documents")
    .select("draw_number")
    .eq("job_id", jobId)
    .eq("is_progress_draw", true)
    .order("draw_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data?.draw_number ?? 0) + 1;
}
