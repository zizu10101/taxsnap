import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, SubscriptionStatus } from "@/lib/database.types";
import { getPresetRange, rangeToUtcBounds } from "@/lib/date-range";

// Single source of truth for every tier's usage caps under the
// capped-forever-freemium model: every tier gets every feature, only the
// ceiling on how much of it differs. `null` means unlimited. This is the
// schema/logic layer only (step 1) - pricing copy and UI still live
// wherever they already did (src/lib/pricing-plans.ts, the landing page,
// /billing) and aren't wired to this table yet.
//
// - scansPerMonth: receipt scans, still enforced inline in
//   api/parse-receipt (a soft cap-with-exemption, not a hard block) -
//   listed here for completeness/documentation, not read by the helpers
//   below.
// - invoicesPerMonth: documents where type = 'invoice', counted by
//   created_at (not issue_date, which is user-editable/backdatable and
//   would let the cap be evaded). A converted estimate
//   (POST /api/documents/[id]/convert) inserts a brand-new invoice row,
//   so it's counted automatically - estimates themselves are never
//   counted, since they're a different `type` value.
// - clients / jobs: lifetime row counts (neither table has an is_active
//   column), so deleting a row frees a slot.
// - employees / activeServices / activeStylists: counts of active rows
//   only (each table's `is_active` column) - deactivating frees a slot,
//   matching the pre-existing services/stylists behavior.
export const PLAN_LIMITS: Record<
  SubscriptionStatus,
  {
    scansPerMonth: number | null;
    invoicesPerMonth: number | null;
    clients: number | null;
    jobs: number | null;
    employees: number | null;
    activeServices: number | null;
    activeStylists: number | null;
  }
> = {
  free: {
    scansPerMonth: 5,
    invoicesPerMonth: 3,
    clients: 3,
    jobs: 1,
    employees: 1,
    activeServices: 1,
    activeStylists: 1,
  },
  basic: {
    scansPerMonth: null,
    invoicesPerMonth: 10,
    clients: 10,
    jobs: 5,
    employees: 5,
    activeServices: 3,
    activeStylists: 2,
  },
  pro: {
    scansPerMonth: null,
    invoicesPerMonth: null,
    clients: null,
    jobs: null,
    employees: null,
    activeServices: null,
    activeStylists: null,
  },
};

// The tier a user should be pointed at to raise a given limit - "basic"
// for anyone currently on free (basic already raises every cap above
// free's), "pro" for anyone already on basic (pro is the only tier left
// with a higher/unlimited cap). Used to build tier-correct upgrade copy
// instead of always saying "Upgrade to Pro" - a Basic user can now hit a
// cap too (e.g. 10 clients), and telling them to upgrade to a plan they
// already have would be wrong.
export function nextTierFor(status: SubscriptionStatus): "basic" | "pro" {
  return status === "free" ? "basic" : "pro";
}

const TIER_LABEL: Record<"basic" | "pro", string> = { basic: "Basic", pro: "Pro" };

// Builds the FREE_LIMIT_REACHED error string every capped route returns,
// naming whichever tier actually raises the limit for this user's current
// tier (see nextTierFor) instead of hardcoding "Upgrade to Pro" - a Basic
// user hitting a cap needs to be told to upgrade to Pro, not Basic.
// `singularNoun` is pluralized automatically when the limit isn't 1 (e.g.
// Basic's "3 active services" vs. Free's "1 active service"). `period`
// (e.g. "this month") is optional, for monthly caps like invoices.
export function limitReachedMessage(
  check: LimitCheck,
  singularNoun: string,
  period?: string,
): string {
  const tierLabel = TIER_LABEL[nextTierFor(check.tier)];
  const currentTierLabel = check.tier === "free" ? "Free" : "Basic";
  const noun = check.limit === 1 ? singularNoun : `${singularNoun}s`;
  const periodSuffix = period ? ` ${period}` : "";
  return `${currentTierLabel} accounts can have ${check.limit} ${noun}${periodSuffix}. Upgrade to ${tierLabel} to add more.`;
}

async function getSubscriptionStatus(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<SubscriptionStatus> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_status")
    .eq("id", userId)
    .single();
  return profile?.subscription_status ?? "free";
}

export interface LimitCheck {
  exceeded: boolean;
  limit: number | null;
  current: number;
  tier: SubscriptionStatus;
}

// Monthly-count caps (currently just invoices). Windowed on created_at
// via the same "this-month" preset the scan cap uses in
// api/parse-receipt/route.ts, for the same reason: usage resets monthly,
// not a lifetime cap.
export async function wouldExceedMonthlyLimit(
  supabase: SupabaseClient<Database>,
  userId: string,
  resource: "invoices",
): Promise<LimitCheck> {
  const tier = await getSubscriptionStatus(supabase, userId);
  const limit =
    resource === "invoices" ? PLAN_LIMITS[tier].invoicesPerMonth : null;

  if (limit === null) {
    return { exceeded: false, limit: null, current: 0, tier };
  }

  const { from } = rangeToUtcBounds(getPresetRange("this-month"));
  const { count } = await supabase
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("type", "invoice")
    .gte("created_at", from!);

  const current = count ?? 0;
  return { exceeded: current >= limit, limit, current, tier };
}

// Lifetime total-row caps (clients, jobs) - no is_active column on either
// table, so a deleted row frees a slot back up.
export async function wouldExceedTotalLimit(
  supabase: SupabaseClient<Database>,
  userId: string,
  resource: "clients" | "jobs",
): Promise<LimitCheck> {
  const tier = await getSubscriptionStatus(supabase, userId);
  const limit = PLAN_LIMITS[tier][resource];

  if (limit === null) {
    return { exceeded: false, limit: null, current: 0, tier };
  }

  const { count } = await supabase
    .from(resource)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  const current = count ?? 0;
  return { exceeded: current >= limit, limit, current, tier };
}

const ACTIVE_LIMIT_TABLE = {
  employees: "employees",
  services: "services",
  stylists: "stylists",
} as const;

const ACTIVE_LIMIT_KEY = {
  employees: "employees",
  services: "activeServices",
  stylists: "activeStylists",
} as const;

// Active-row caps (employees, services, stylists) - generalizes the old
// wouldExceedFreeTierActiveLimit (free-tier-limits.ts, now deleted) to a
// per-tier limit table instead of a single free-only constant, since
// Basic now gets its own (higher, but still capped) active-row ceiling
// too. Checked in two places for each table, same as before: creating a
// new row (which always defaults to active) and reactivating an existing
// inactive one via PATCH { is_active: true } - `excludeId` omits the row
// being edited from its own count so a deactivate-then-reactivate cycle
// can't trivially evade the cap.
export async function wouldExceedActiveLimit(
  supabase: SupabaseClient<Database>,
  userId: string,
  resource: "employees" | "services" | "stylists",
  excludeId?: string,
): Promise<LimitCheck> {
  const tier = await getSubscriptionStatus(supabase, userId);
  const limit = PLAN_LIMITS[tier][ACTIVE_LIMIT_KEY[resource]];

  if (limit === null) {
    return { exceeded: false, limit: null, current: 0, tier };
  }

  let query = supabase
    .from(ACTIVE_LIMIT_TABLE[resource])
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_active", true);

  if (excludeId) query = query.neq("id", excludeId);

  const { count } = await query;
  const current = count ?? 0;
  return { exceeded: current >= limit, limit, current, tier };
}
