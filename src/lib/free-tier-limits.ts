import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// Free-tier salon accounts get a limited preview of Commission - up to
// this many *active* rows each in services/stylists, enough to actually
// try the real 3-tap logging loop end to end before upgrading. Pro
// accounts have no cap at all (callers should skip this check entirely
// once they already know isPro).
export const FREE_TIER_ACTIVE_LIMIT = 1;

// Checked in two places for each table: creating a new row (which always
// defaults to active) and reactivating an existing inactive one via
// PATCH { is_active: true } - otherwise a free account could trivially
// exceed the cap by deactivating-then-reactivating rows instead of ever
// using the "add" flow a second time. `excludeId` omits the row being
// edited from its own count, so a redundant `is_active: true` on an
// already-active row (not something either dialog's toggle button
// actually sends today, but a real caller-shape guarantee rather than an
// incidental one) is never miscounted as "adding a second."
export async function wouldExceedFreeTierActiveLimit(
  supabase: SupabaseClient<Database>,
  userId: string,
  table: "services" | "stylists",
  excludeId?: string,
): Promise<boolean> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_status")
    .eq("id", userId)
    .single();

  if (profile?.subscription_status === "pro") return false;

  let query = supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_active", true);

  if (excludeId) query = query.neq("id", excludeId);

  const { count } = await query;
  return (count ?? 0) >= FREE_TIER_ACTIVE_LIMIT;
}
