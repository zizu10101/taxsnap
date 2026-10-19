import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import { findJobByName } from "./find-by-name.ts";
import { limitReachedMessage, wouldExceedTotalLimit } from "./plan-limits.ts";

// Several routes create a job on the fly from a typed name (a document's
// job_name, an hour entry's job_name, a receipt's job_name via the 0009
// trigger). They all have to honour the same plan cap POST /api/jobs does,
// otherwise a Free account could walk past it through any of those doors.
// Returns the message to refuse with, or null when the job already exists
// (nothing new is created) or there is room for another one.
export async function newJobCapMessage(
  supabase: SupabaseClient<Database>,
  userId: string,
  name: string | null | undefined,
): Promise<string | null> {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  if (await findJobByName(supabase, userId, trimmed)) return null;
  const check = await wouldExceedTotalLimit(supabase, userId, "jobs");
  return check.exceeded ? limitReachedMessage(check, "job") : null;
}
