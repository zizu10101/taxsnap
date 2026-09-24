import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/dashboard/page-header";
import { JobList } from "@/components/jobs/job-list";
import { buildJobCostSummaries } from "@/lib/job-revenue";

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

  const [{ data: jobs }, { data: receipts }, { data: hourEntries }, { data: documents }] =
    await Promise.all([
      supabase.from("jobs").select("*").order("name", { ascending: true }),
      supabase
        .from("receipts")
        .select("job_id, total_amount")
        .not("job_id", "is", null),
      supabase
        .from("hour_entries")
        .select("job_id, labor_cost, labor_revenue")
        .not("job_id", "is", null),
      supabase
        .from("documents")
        .select("job_id, type, subtotal, total_amount, payments(amount)")
        .not("job_id", "is", null),
    ]);

  // Every job's cost/revenue rollup, computed once here so the lg+
  // workstation's live preview (see JobWorkstation) can switch between
  // jobs instantly instead of fetching per click.
  const costSummaries = buildJobCostSummaries(
    (jobs ?? []).map((j) => j.id),
    receipts ?? [],
    hourEntries ?? [],
    documents ?? [],
  );

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 lg:max-w-none">
      <PageHeader
        backHref="/dashboard"
        title="Jobs"
        subtitle="True cost per job: tagged expenses plus logged labor."
      />

      <JobList
        initialJobs={jobs ?? []}
        subscriptionStatus={profile?.subscription_status ?? "free"}
        costSummaries={Object.fromEntries(costSummaries)}
      />
    </div>
  );
}
