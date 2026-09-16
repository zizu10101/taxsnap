import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// Find-or-create a job by name, scoped to this user - same behavior as
// the job_name path in POST /api/documents, extracted here since
// expense-templates needs the identical resolution for both its create
// and edit routes. Returns null for a blank/missing name (no job).
export async function resolveJobIdByName(
  supabase: SupabaseClient<Database>,
  userId: string,
  jobName: string | null | undefined,
): Promise<string | null> {
  const name = jobName?.trim();
  if (!name) return null;

  const { data: existingJob } = await supabase
    .from("jobs")
    .select("id")
    .eq("user_id", userId)
    .eq("name", name)
    .maybeSingle();

  if (existingJob) return existingJob.id;

  const { data: newJob, error } = await supabase
    .from("jobs")
    .insert({ user_id: userId, name })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return newJob.id;
}
