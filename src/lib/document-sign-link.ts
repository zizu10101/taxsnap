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
