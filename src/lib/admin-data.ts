import { createAdminClient } from "@/lib/supabase/server";
import { getStripe, STRIPE_PRICE_IDS } from "@/lib/stripe";
import type {
  BillingInterval,
  BusinessType,
  SubscriptionStatus,
} from "@/lib/database.types";

// Read-only data layer for /admin. Everything here uses the service-role
// client (bypasses RLS), so it must only ever be called after requireAdmin()
// has passed. Receipt/invoice access is count-only (`head: true`) - no row
// content is ever selected.

const PAGE_SIZE = 50;
const TIERS: SubscriptionStatus[] = ["free", "basic", "pro"];
const BUSINESS_TYPES: BusinessType[] = ["general", "salon"];
const SIGNUP_WINDOW_DAYS = 30;

export interface AdminAccountRow {
  id: string;
  email: string;
  business_type: BusinessType;
  subscription_status: SubscriptionStatus;
  billing_interval: BillingInterval | null;
  created_at: string;
  stripeSynced: boolean;
}

export async function listAccounts(query: string, page: number) {
  const supabase = createAdminClient();
  const from = (page - 1) * PAGE_SIZE;

  let q = supabase
    .from("profiles")
    .select(
      "id, email, business_type, subscription_status, billing_interval, created_at, stripe_customer_id",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  // Escape LIKE wildcards so a search for "a_b" or "50%" matches literally.
  const term = query.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
  if (term) q = q.ilike("email", `%${term}%`);

  const { data, count, error } = await q;
  if (error) throw new Error(error.message);

  const rows: AdminAccountRow[] = (data ?? []).map((p) => ({
    id: p.id,
    email: p.email,
    business_type: p.business_type,
    subscription_status: p.subscription_status,
    billing_interval: p.billing_interval,
    created_at: p.created_at,
    stripeSynced: !!p.stripe_customer_id,
  }));

  return { rows, total: count ?? 0, pageSize: PAGE_SIZE };
}

export interface SignupBucket {
  date: string; // YYYY-MM-DD (UTC)
  label: string;
  count: number;
}

export async function getMetrics() {
  const supabase = createAdminClient();

  const byTier = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<SubscriptionStatus, number>;
  const byBusinessType = Object.fromEntries(BUSINESS_TYPES.map((b) => [b, 0])) as Record<
    BusinessType,
    number
  >;

  const [tierCounts, typeCounts] = await Promise.all([
    Promise.all(
      TIERS.map((t) =>
        supabase
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("subscription_status", t),
      ),
    ),
    Promise.all(
      BUSINESS_TYPES.map((b) =>
        supabase
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("business_type", b),
      ),
    ),
  ]);
  TIERS.forEach((t, i) => (byTier[t] = tierCounts[i].count ?? 0));
  BUSINESS_TYPES.forEach((b, i) => (byBusinessType[b] = typeCounts[i].count ?? 0));

  // Signups per UTC day over the last 30 days (inclusive of today). Paged in
  // 1000-row chunks since PostgREST caps a single response at 1000 rows.
  const today = new Date();
  const start = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (SIGNUP_WINDOW_DAYS - 1)),
  );
  const counts = new Map<string, number>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("profiles")
      .select("created_at")
      .gte("created_at", start.toISOString())
      .order("created_at", { ascending: true })
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const day = row.created_at.slice(0, 10);
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
    if (!data || data.length < 1000) break;
  }

  const signups: SignupBucket[] = [];
  for (let i = 0; i < SIGNUP_WINDOW_DAYS; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const date = d.toISOString().slice(0, 10);
    signups.push({
      date,
      label: d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
      count: counts.get(date) ?? 0,
    });
  }

  const total = TIERS.reduce((sum, t) => sum + byTier[t], 0);
  const signupsLast30 = signups.reduce((sum, b) => sum + b.count, 0);

  return { total, byTier, byBusinessType, signups, signupsLast30 };
}

// --- Account detail ---

export interface StripeLiveState {
  found: boolean;
  error?: string;
  subscriptionId?: string;
  status?: string;
  tier?: SubscriptionStatus;
  interval?: BillingInterval | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  hasSchedule?: boolean;
}

export interface MismatchRow {
  field: string;
  stored: string;
  live: string;
  mismatch: boolean;
}

function tierFromPriceId(priceId: string | undefined): SubscriptionStatus {
  if (priceId === STRIPE_PRICE_IDS.pro.monthly || priceId === STRIPE_PRICE_IDS.pro.yearly) {
    return "pro";
  }
  if (priceId === STRIPE_PRICE_IDS.basic.monthly || priceId === STRIPE_PRICE_IDS.basic.yearly) {
    return "basic";
  }
  return "free";
}

async function fetchStripeState(
  customerId: string | null,
  subscriptionId: string | null,
): Promise<StripeLiveState | null> {
  if (!customerId && !subscriptionId) return null;

  try {
    const stripe = getStripe();
    let sub = null;

    if (subscriptionId) {
      try {
        sub = await stripe.subscriptions.retrieve(subscriptionId);
      } catch (err) {
        // Stored ID no longer resolves - fall through to the customer lookup
        // so the page can still show what Stripe actually has on file.
        if ((err as { code?: string }).code !== "resource_missing") throw err;
      }
    }

    if (!sub && customerId) {
      const list = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 1 });
      sub = list.data[0] ?? null;
    }

    if (!sub) return { found: false };

    const item = sub.items.data[0];
    const isActive = ["active", "trialing"].includes(sub.status);
    return {
      found: true,
      subscriptionId: sub.id,
      status: sub.status,
      tier: isActive ? tierFromPriceId(item?.price?.id) : "free",
      interval:
        item?.price?.recurring?.interval === "month"
          ? "monthly"
          : item?.price?.recurring?.interval === "year"
            ? "yearly"
            : null,
      currentPeriodEnd: item ? new Date(item.current_period_end * 1000).toISOString() : null,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      hasSchedule: !!sub.schedule,
    };
  } catch (err) {
    return { found: false, error: err instanceof Error ? err.message : "Stripe lookup failed" };
  }
}

export async function getAccountDetail(id: string) {
  const supabase = createAdminClient();

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", id).maybeSingle();
  if (!profile) return null;

  const [receipts, invoices, stripeLive] = await Promise.all([
    supabase.from("receipts").select("id", { count: "exact", head: true }).eq("user_id", id),
    supabase
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("user_id", id)
      .eq("type", "invoice"),
    fetchStripeState(profile.stripe_customer_id, profile.stripe_subscription_id),
  ]);

  const rows: MismatchRow[] = [];
  if (stripeLive?.found) {
    const cmp = (field: string, stored: string, live: string): MismatchRow => ({
      field,
      stored,
      live,
      mismatch: stored !== live,
    });
    rows.push(
      cmp("Tier", profile.subscription_status, stripeLive.tier ?? "free"),
      cmp("Billing interval", profile.billing_interval ?? "—", stripeLive.interval ?? "—"),
      cmp("Subscription ID", profile.stripe_subscription_id ?? "—", stripeLive.subscriptionId ?? "—"),
      cmp(
        "Cancels at period end",
        String(profile.cancel_at_period_end),
        String(stripeLive.cancelAtPeriodEnd ?? false),
      ),
      cmp(
        "Pending change",
        profile.pending_tier ? "yes" : "none",
        stripeLive.hasSchedule ? "yes" : "none",
      ),
    );
  }

  return {
    profile,
    receiptCount: receipts.count ?? 0,
    invoiceCount: invoices.count ?? 0,
    stripeLive,
    rows,
  };
}
