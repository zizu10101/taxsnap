import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/dashboard/page-header";
import { HowThisWorks } from "@/components/ui/how-this-works";

import { JobList } from "@/components/jobs/job-list";
import { buildJobCostSummaries } from "@/lib/job-revenue";
import { selectAll } from "@/lib/select-all";

export const metadata: Metadata = {
  title: "Jobs — TaxSnap",
};

// Jobs is capped, not Pro-only, at every tier now (1/5/unlimited - see
// src/lib/plan-limits.ts) - every tier fetches and renders the real list,
// the cap only bites in JobList's own create flow when it hits
// POST /api/jobs's FREE_LIMIT_REACHED response.
export default async function JobsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth");

  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_status, business_type, logo_url")
    .eq("id", user.id)
    .single();

  // Job costing adds up EVERY job-linked expense, hours entry and invoice: all pages of each (the API's own
  // 1000-row page would understate every job's cost once an owner has more than that).
  const [{ data: jobs }, { rows: receipts }, { rows: hourEntries }, { rows: documents }, { data: clients }] =
    await Promise.all([
      supabase.from("jobs").select("*").order("name", { ascending: true }),
      selectAll(() =>
        supabase
          .from("receipts")
          .select("job_id, total_amount")
          .not("job_id", "is", null)
          .order("id", { ascending: true }),
      ),
      selectAll(() =>
        supabase
          .from("hour_entries")
          .select("job_id, labor_cost, labor_revenue")
          .not("job_id", "is", null)
          .order("id", { ascending: true }),
      ),
      selectAll(() =>
        supabase
          .from("documents")
          .select("job_id, type, subtotal, total_amount, excluded_from_hst, payments(amount)")
          .not("job_id", "is", null)
          .order("id", { ascending: true }),
      ),
      supabase.from("clients").select("id, name").eq("is_sample", false).order("name", { ascending: true }),
    ]);

  // Every job's cost/revenue rollup, computed once here so the lg+
  // workstation's live preview (see JobWorkstation) can switch between
  // jobs instantly instead of fetching per click.
  const costSummaries = buildJobCostSummaries(
    (jobs ?? []).map((j) => j.id),
    receipts,
    hourEntries,
    documents,
    // Same revenue rule as the P&L, Overview and the HST helper.
    { honorExcludedFromHst: true },
  );

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 lg:max-w-none">
      <PageHeader
        backHref="/dashboard"
        title="Jobs"
        subtitle="True cost per job: tagged expenses plus logged labor."
        actions={
          <Link
            href="/dashboard/photos"
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Unsorted photos
          </Link>
        }
      />

      <HowThisWorks tab="jobs" userId={user.id} empty={(jobs ?? []).length === 0} />

      <JobList
        initialJobs={jobs ?? []}
        subscriptionStatus={profile?.subscription_status ?? "free"}
        costSummaries={Object.fromEntries(costSummaries)}
        clients={clients ?? []}
      />
    </div>
  );
}
