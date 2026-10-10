import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { generateOpaqueToken } from "@/lib/opaque-token";

export class EstimateNotFoundError extends Error {
  constructor() {
    super("Estimate not found.");
  }
}

// Shared by POST /api/documents/[id]/sign-link (the "Copy Link" action)
// and POST /api/documents/[id]/send-signature-email (the "Email
// Signature Link to Client" action) - both need the exact same lazy,
// idempotent token creation, just to deliver the resulting link through a
// different channel afterward.
export async function ensureSignToken(
  supabase: SupabaseClient<Database>,
  documentId: string,
  userId: string,
): Promise<string> {
  const { data: estimate, error: fetchError } = await supabase
    .from("documents")
    .select("id, sign_token")
    .eq("id", documentId)
    .eq("user_id", userId)
    .eq("type", "estimate")
    .single();

  if (fetchError || !estimate) {
    throw new EstimateNotFoundError();
  }

  if (estimate.sign_token) {
    return estimate.sign_token;
  }

  const token = generateOpaqueToken();
  const { error: updateError } = await supabase
    .from("documents")
    .update({ sign_token: token })
    .eq("id", documentId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  return token;
}

export class InvoiceNotFoundError extends Error {
  constructor() {
    super("Invoice not found.");
  }
}

// The invoice counterpart of ensureSignToken, for the Send menu's "Copy link": the public read-only
// /invoice/[view_token] page. An invoice converted from a signed estimate already has one; any other
// invoice gets it created here, the first time the owner asks. Idempotent, and it touches nothing but
// the token - never the status.
export async function ensureViewToken(
  supabase: SupabaseClient<Database>,
  documentId: string,
  userId: string,
): Promise<string> {
  const { data: invoice, error: fetchError } = await supabase
    .from("documents")
    .select("id, view_token")
    .eq("id", documentId)
    .eq("user_id", userId)
    .eq("type", "invoice")
    .single();

  if (fetchError || !invoice) {
    throw new InvoiceNotFoundError();
  }
  if (invoice.view_token) return invoice.view_token;

  const token = generateOpaqueToken();
  const { error: updateError } = await supabase
    .from("documents")
    .update({ view_token: token })
    .eq("id", documentId)
    .eq("user_id", userId);
  if (updateError) throw new Error(updateError.message);
  return token;
}
