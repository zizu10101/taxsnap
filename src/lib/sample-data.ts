import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import { SAMPLE_BLOCKED_MESSAGE, SAMPLE_JOB_NAME } from "./onboarding.ts";

// The sample client and job exist only to look around. A real invoice,
// estimate, receipt or hour entry may never point at them - that is the single
// rule that keeps sample data out of PDFs, public pages, portals, emails,
// exports and the HST totals (those are all built from documents, receipts and
// payments). Returns the message to refuse with, or null when nothing sample is
// involved. Ownership is re-checked with user_id on every lookup.
export async function sampleBlockMessage(
  supabase: SupabaseClient<Database>,
  userId: string,
  refs: { clientId?: string | null; jobId?: string | null; jobName?: string | null },
): Promise<string | null> {
  if (refs.clientId) {
    const { data } = await supabase
      .from("clients")
      .select("id")
      .eq("id", refs.clientId)
      .eq("user_id", userId)
      .eq("is_sample", true)
      .maybeSingle();
    if (data) return SAMPLE_BLOCKED_MESSAGE;
  }
  if (refs.jobId) {
    const { data } = await supabase
      .from("jobs")
      .select("id")
      .eq("id", refs.jobId)
      .eq("user_id", userId)
      .eq("is_sample", true)
      .maybeSingle();
    if (data) return SAMPLE_BLOCKED_MESSAGE;
  }
  const name = refs.jobName?.trim();
  if (name && name.toLowerCase() === SAMPLE_JOB_NAME.toLowerCase()) return SAMPLE_BLOCKED_MESSAGE;
  return null;
}
