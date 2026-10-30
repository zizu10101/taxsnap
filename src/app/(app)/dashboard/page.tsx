import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardBody } from "@/components/dashboard/dashboard-body";
import { checklistItems, storedGoals } from "@/lib/onboarding";
import { selectAll } from "@/lib/select-all";

export const metadata: Metadata = {
  title: "Dashboard — TaxSnap",
};

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "subscription_status, business_type, logo_url, onboarding_completed, needs_business_type_prompt, business_name, business_email, business_phone, business_address, business_number, onboarding_goal, onboarding_goals, first_invoice_sent_at, first_receipt_saved_at, checklist_dismissed_at",
    )
    .eq("id", user.id)
    .single();

  // Checked before the onboarding redirect below, deliberately - a
  // brand-new Google signup's business_type is still just the column
  // default ('general') until they answer this, and /onboarding itself
  // branches on business_type to pick a flow, so that branch can't fire
  // correctly until after this resolves it. Same "only place that
  // redirects here" scoping as the onboarding check.
  if (profile?.needs_business_type_prompt) {
    redirect("/auth/choose-business-type");
  }

  // Onboarding shows once for every business type, before this page ever
  // renders for real - /onboarding itself picks the salon (Logo/PINs/
  // Services/Stylists) or general-business (Logo/Business info/Staff) flow
  // from business_type. Anyone who's already finished (or skipped through)
  // it lands here normally. This is the only place that redirects to
  // /onboarding; every other /dashboard/** page is reachable directly
  // regardless (e.g. a bookmark, or a redirectTo bounce elsewhere).
  if (profile && !profile.onboarding_completed) {
    redirect("/onboarding");
  }

  const [
    { rows: receipts, truncated: receiptsTruncated },
    { data: jobs },
    { count: realClients },
    { count: sampleClients },
    { count: realJobs },
    { count: services },
    { count: stylists },
  ] = await Promise.all([
    // Every expense, not just the first 1000 per request (see lib/select-all.ts).
    selectAll(() =>
      supabase
        .from("receipts")
        .select("*")
        .order("transaction_date", { ascending: false })
        .order("id", { ascending: true }),
    ),
    // Job names for the receipt job picker - not Pro-gated (job tagging on
    // receipts is available on every tier), so this reads the jobs table
    // directly rather than going through the Pro-only /api/jobs route.
    supabase.from("jobs").select("name").eq("is_sample", false).order("name", { ascending: true }),
    // Checklist state. The sample client never counts as "added a client".
    supabase.from("clients").select("id", { count: "exact", head: true }).eq("is_sample", false),
    supabase.from("clients").select("id", { count: "exact", head: true }).eq("is_sample", true),
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq("is_sample", false),
    supabase.from("services").select("id", { count: "exact", head: true }),
    supabase.from("stylists").select("id", { count: "exact", head: true }),
  ]);

  const goals = storedGoals(profile?.onboarding_goals, profile?.onboarding_goal);
  const onboarding = {
    userId: user.id,
    items: checklistItems(goals, {
      hasClient: (realClients ?? 0) > 0,
      invoiceSent: !!profile?.first_invoice_sent_at,
      receiptSaved: !!profile?.first_receipt_saved_at,
      hasJob: (realJobs ?? 0) > 0,
      hasService: (services ?? 0) > 0,
      hasStylist: (stylists ?? 0) > 0,
    }),
    dismissedAt: profile?.checklist_dismissed_at ?? null,
    sampleExists: (sampleClients ?? 0) > 0,
  };

  return (
    <DashboardBody
      initialReceipts={receipts}
      receiptsTruncated={receiptsTruncated}
      initialJobNames={(jobs ?? []).map((j) => j.name)}
      businessType={profile?.business_type ?? "general"}
      subscriptionStatus={profile?.subscription_status ?? "free"}
      business={{
        name: profile?.business_name ?? null,
        email: profile?.business_email || user.email || "",
        phone: profile?.business_phone ?? null,
        address: profile?.business_address ?? null,
        hstNumber: profile?.business_number ?? null,
      }}
      logoPath={profile?.logo_url ?? null}
      onboarding={onboarding}
    />
  );
}
