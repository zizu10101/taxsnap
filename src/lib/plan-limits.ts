import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, SubscriptionStatus } from "./database.types.ts";
import { getPresetRange, rangeToUtcBounds } from "./date-range.ts";

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
// - clients / jobs / expenseTemplates: lifetime row counts (none of
//   these tables has an is_active column), so deleting a row frees a
//   slot. expenseTemplates - receipts.source_template_id is nullable/
//   on-delete-set-null purely for optional traceability, so deleting a
//   template never orphans a past expense logged from it.
// - employees / activeServices / activeStylists / lineItems: counts of
//   active rows only (each table's `is_active` column) - deactivating
//   frees a slot, matching the pre-existing services/stylists behavior.
//   lineItems switched to this shape (was a total-count cap) once a
//   management view needed a way to hide an item from future invoices
//   without losing it - document_items still snapshots its own
//   description/unit_price at add time either way, so this was never
//   forced by a downstream reference, just by wanting Deactivate/
//   Reactivate instead of a permanent delete.
// - statementImportsPerMonth: card-statement imports (api/statements), counted
//   in the database by statement_imports.created_at in Toronto's calendar month
//   (start_statement_import enforces it, so two tabs can't both slip under).
//   Retries of one import never count again; an import where nothing could be
//   read ('failed') is free. PROVISIONAL: these numbers are placeholders until
//   real token cost per statement has been measured (statement_imports records
//   input_tokens/output_tokens), and the feature is allowlist-only until then
//   (STATEMENT_IMPORT_USER_IDS) - see lib/statement-config.ts.
// - manualSalesEntriesPerMonth: rows in `sales`, counted by created_at
//   (never touched by a later edit to the same period - see the upsert in
//   api/sales/route.ts) - unlimited/null here still means "no cap", but
//   only applies to general-business accounts; salon accounts stay fully
//   unrestricted at every tier regardless of this value (see
//   api/sales/route.ts's own business_type check, predating this cap and
//   deliberately untouched by it).
// - photos: site photos (job_photos rows, Unsorted ones included), a lifetime row count, so deleting a
//   photo (or its job) frees a slot. PLACEHOLDER numbers (Free 10, Pro 2000) until real
//   storage cost is known - not final pricing. Enforced on the server in api/job-photos.
export const PLAN_LIMITS: Record<
  SubscriptionStatus,
  {
    scansPerMonth: number | null;
    invoicesPerMonth: number | null;
    clients: number | null;
    jobs: number | null;
    lineItems: number | null;
    expenseTemplates: number | null;
    employees: number | null;
    activeServices: number | null;
    activeStylists: number | null;
    activeProducts: number | null;
    activeRenters: number | null;
    manualSalesEntriesPerMonth: number | null;
    statementImportsPerMonth: number | null;
    photos: number | null;
  }
> = {
  free: {
    scansPerMonth: 5,
    invoicesPerMonth: 3,
    clients: 3,
    jobs: 1,
    lineItems: 1,
    expenseTemplates: 3,
    employees: 1,
    activeServices: 1,
    activeStylists: 1,
    activeProducts: 1,
    activeRenters: 1,
    manualSalesEntriesPerMonth: 3,
    statementImportsPerMonth: 1, // provisional
    photos: 10, // PLACEHOLDER
  },
  pro: {
    scansPerMonth: null,
    invoicesPerMonth: null,
    clients: null,
    jobs: null,
    lineItems: null,
    expenseTemplates: null,
    employees: null,
    activeServices: null,
    activeStylists: null,
    activeProducts: null,
    activeRenters: null,
    manualSalesEntriesPerMonth: null,
    statementImportsPerMonth: 10, // provisional
    photos: 2000, // PLACEHOLDER
  },
};

// Shared "Unlimited" vs. number formatting for a raw PLAN_LIMITS value -
// used by every UI surface that displays a cap (PlanCapsTable,
// CurrentPlanCard, the homepage's feature-comparison table) so the exact
// wording can't drift between them. `suffix` is appended only to a real
// number (e.g. "/mo"), never to "Unlimited".
export function formatPlanCap(n: number | null, suffix = ""): string {
  return n === null ? "Unlimited" : `${n}${suffix}`;
}

// Builds the FREE_LIMIT_REACHED error string every capped route returns. Free
// and Pro are the only plans, so the only upgrade path is Free -> Pro.
// `singularNoun` is pluralized automatically when the limit isn't 1 (e.g.
// "3 clients" vs. "1 job") by appending "s" - pass `pluralNoun` explicitly
// for a noun that doesn't pluralize that way (e.g. "entry" -> "entries",
// not "entrys"). `period` (e.g. "this month") is optional, for monthly caps
// like invoices.
export function limitReachedMessage(
  check: LimitCheck,
  singularNoun: string,
  period?: string,
  pluralNoun?: string,
): string {
  const noun = check.limit === 1 ? singularNoun : (pluralNoun ?? `${singularNoun}s`);
  const periodSuffix = period ? ` ${period}` : "";
  return `Free accounts can have ${check.limit} ${noun}${periodSuffix}. Upgrade to Pro to add more.`;
}

// Any stored value other than "pro" is Free. A leftover 'basic' row (the
// retired tier, before the cleanup SQL has run) must never index
// PLAN_LIMITS with an unknown key, so every reader goes through this.
export function normalizeTier(value: string | null | undefined): SubscriptionStatus {
  return value === "pro" ? "pro" : "free";
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
  return normalizeTier(profile?.subscription_status);
}

export interface LimitCheck {
  exceeded: boolean;
  limit: number | null;
  current: number;
  tier: SubscriptionStatus;
}

const MONTHLY_LIMIT_KEY = {
  invoices: "invoicesPerMonth",
  sales: "manualSalesEntriesPerMonth",
} as const;

// Monthly-count caps (invoices, manual sales entries). Windowed on
// created_at via the same "this-month" preset the scan cap uses in
// api/parse-receipt/route.ts, for the same reason: usage resets monthly,
// not a lifetime cap. For "sales", the caller is responsible for only
// invoking this when the request is actually a new period (a plain edit
// to an already-existing period_label shouldn't count against the cap -
// see api/sales/route.ts) and for skipping this entirely for salon
// accounts, which stay unrestricted regardless of this table's value.
export async function wouldExceedMonthlyLimit(
  supabase: SupabaseClient<Database>,
  userId: string,
  resource: "invoices" | "sales",
): Promise<LimitCheck> {
  const tier = await getSubscriptionStatus(supabase, userId);
  const limit = PLAN_LIMITS[tier][MONTHLY_LIMIT_KEY[resource]];

  if (limit === null) {
    return { exceeded: false, limit: null, current: 0, tier };
  }

  const { from } = rangeToUtcBounds(getPresetRange("this-month"));
  const { count } =
    resource === "invoices"
      ? await supabase
          .from("documents")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("type", "invoice")
          .gte("created_at", from!)
      : await supabase
          .from("sales")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .gte("created_at", from!);

  const current = count ?? 0;
  return { exceeded: current >= limit, limit, current, tier };
}

// Lifetime total-row caps (clients, jobs) - no is_active column on either
// table, so a deleted row frees a slot back up.
const TOTAL_LIMIT_TABLE = {
  clients: "clients",
  jobs: "jobs",
  expenseTemplates: "expense_templates",
  photos: "job_photos",
} as const;

export async function wouldExceedTotalLimit(
  supabase: SupabaseClient<Database>,
  userId: string,
  resource: "clients" | "jobs" | "expenseTemplates" | "photos",
): Promise<LimitCheck> {
  const tier = await getSubscriptionStatus(supabase, userId);
  const limit = PLAN_LIMITS[tier][resource];

  if (limit === null) {
    return { exceeded: false, limit: null, current: 0, tier };
  }

  const { count } = await supabase
    .from(TOTAL_LIMIT_TABLE[resource])
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  const current = count ?? 0;
  return { exceeded: current >= limit, limit, current, tier };
}

const ACTIVE_LIMIT_TABLE = {
  employees: "employees",
  services: "services",
  stylists: "stylists",
  lineItems: "line_items",
  products: "products",
  renters: "renters",
} as const;

const ACTIVE_LIMIT_KEY = {
  employees: "employees",
  services: "activeServices",
  stylists: "activeStylists",
  lineItems: "lineItems",
  products: "activeProducts",
  renters: "activeRenters",
} as const;

// Active-row caps (employees, services, stylists) - generalizes the old
// wouldExceedFreeTierActiveLimit (free-tier-limits.ts, now deleted) to a
// per-tier limit table instead of a single free-only constant, since
// Free and Pro each have their own active-row ceiling. Checked in two places for each table, same as before: creating a
// new row (which always defaults to active) and reactivating an existing
// inactive one via PATCH { is_active: true } - `excludeId` omits the row
// being edited from its own count so a deactivate-then-reactivate cycle
// can't trivially evade the cap.
export async function wouldExceedActiveLimit(
  supabase: SupabaseClient<Database>,
  userId: string,
  resource: "employees" | "services" | "stylists" | "lineItems" | "products" | "renters",
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
