import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/dashboard/page-header";
import { JobList } from "@/components/jobs/job-list";

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

  const { data: jobs } = await supabase
    .from("jobs")
    .select("*")
    .order("name", { ascending: true });

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <PageHeader
        backHref="/dashboard"
        title="Jobs"
        subtitle="True cost per job: tagged expenses plus logged labor."
      />

      <JobList
        initialJobs={jobs ?? []}
        subscriptionStatus={profile?.subscription_status ?? "free"}
      />
    </div>
  );
}
