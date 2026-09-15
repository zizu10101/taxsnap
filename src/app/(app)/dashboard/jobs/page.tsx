import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
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
    <div className="flex min-h-screen flex-col bg-muted/30">
      <DashboardHeader
        email={user.email ?? ""}
        subscriptionStatus={profile?.subscription_status ?? "free"}
        businessType={profile?.business_type ?? "general"}
        logoPath={profile?.logo_url ?? null}
        active="jobs"
      />
      <main className="mx-auto w-full max-w-2xl flex-1 p-4">
        <Link
          href="/dashboard"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Link>

        <div className="mb-6">
          <h1 className="text-2xl font-bold">Jobs</h1>
          <p className="text-muted-foreground">
            True cost per job: tagged expenses plus logged labor.
          </p>
        </div>

        <JobList
          initialJobs={jobs ?? []}
          subscriptionStatus={profile?.subscription_status ?? "free"}
        />
      </main>
    </div>
  );
}
