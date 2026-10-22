import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import {
  CLIENT_HAS_RECORDS_CODE,
  blockedMessage,
  totalReferences,
  type ClientReferenceCounts,
} from "./client-delete.ts";

// DELETE /api/clients/[id]. Taking a client (not building one) keeps it testable; the route only authenticates.
//
// Rules, all enforced here and not by the UI or by foreign keys:
//  - Only the caller's own client (user_id filter on every query, on top of RLS). Anyone else's id is a 404.
//  - A client that any invoice, estimate (any status, drafts included) or job points at is NOT deleted: 409 with
//    the counts. documents.client_id / jobs.client_id are ON DELETE SET NULL, so without this check the delete
//    would succeed and silently orphan them.
//  - Anything we can't count is a failure (fail closed), never "assume nothing references it".
//  - The "Try with sample data" client has no real records (they are refused for it); its sample job, which
//    references it, is removed with it, exactly as "Remove sample data" does. Real jobs still block.
//  - The client portal login (client_portal_logins/client_sessions, ON DELETE CASCADE) goes with the client:
//    it is access to that client's documents, and there are no documents left to see.
// Deleting a row frees a Free-plan client slot by itself: the cap counts live rows (wouldExceedTotalLimit).
export type ClientDeleteResult =
  | { status: 200; body: { success: true } }
  | { status: 404 | 500; body: { error: string } }
  | { status: 409; body: { error: string; code: typeof CLIENT_HAS_RECORDS_CODE; counts: ClientReferenceCounts } };

const FAILED = "Could not delete the client. Please try again.";

export async function handleClientDelete(
  db: SupabaseClient<Database>,
  userId: string,
  clientId: string,
): Promise<ClientDeleteResult> {
  const { data: client, error: findError } = await db
    .from("clients")
    .select("id, name, is_sample")
    .eq("id", clientId)
    .eq("user_id", userId)
    .maybeSingle();
  if (findError) return { status: 500, body: { error: FAILED } };
  if (!client) return { status: 404, body: { error: "Client not found." } };

  const head = { count: "exact" as const, head: true };
  const [invoices, estimates, jobs, sampleJobs] = await Promise.all([
    db.from("documents").select("id", head).eq("user_id", userId).eq("client_id", clientId).eq("type", "invoice"),
    db.from("documents").select("id", head).eq("user_id", userId).eq("client_id", clientId).eq("type", "estimate"),
    db.from("jobs").select("id", head).eq("user_id", userId).eq("client_id", clientId),
    db.from("jobs").select("id", head).eq("user_id", userId).eq("client_id", clientId).eq("is_sample", true),
  ]);
  if (invoices.error || estimates.error || jobs.error || sampleJobs.error) {
    return { status: 500, body: { error: FAILED } };
  }

  const counts: ClientReferenceCounts = {
    invoices: invoices.count ?? 0,
    estimates: estimates.count ?? 0,
    // A sample job doesn't block the sample client; it is deleted with it below.
    jobs: (jobs.count ?? 0) - (client.is_sample ? (sampleJobs.count ?? 0) : 0),
  };
  if (totalReferences(counts) > 0) {
    return {
      status: 409,
      body: { error: blockedMessage(client.name, counts), code: CLIENT_HAS_RECORDS_CODE, counts },
    };
  }

  if (client.is_sample && (sampleJobs.count ?? 0) > 0) {
    const { error } = await db
      .from("jobs")
      .delete()
      .eq("user_id", userId)
      .eq("client_id", clientId)
      .eq("is_sample", true);
    if (error) return { status: 500, body: { error: FAILED } };
  }

  const { data: deleted, error: deleteError } = await db
    .from("clients")
    .delete()
    .eq("id", clientId)
    .eq("user_id", userId)
    .select("id");
  if (deleteError || !deleted || deleted.length === 0) return { status: 500, body: { error: FAILED } };

  return { status: 200, body: { success: true } };
}
