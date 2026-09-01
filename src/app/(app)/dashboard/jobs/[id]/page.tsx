import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { JobDetail } from "@/components/jobs/job-detail";
import type { HourEntryWithRelations } from "@/lib/database.types";

export const metadata: Metadata = {
  title: "Job — TaxSnap",
};

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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

  if (profile?.subscription_status !== "pro") {
    redirect("/dashboard/jobs");
  }

  const [{ data: job }, { data: receipts }, { data: hourEntries }, { data: employees }, { data: jobs }] =
    await Promise.all([
      supabase.from("jobs").select("*").eq("id", id).single(),
      supabase
        .from("receipts")
        .select("id, merchant_name, transaction_date, total_amount, tax_category")
        .eq("job_id", id)
        .order("transaction_date", { ascending: false }),
      supabase
        .from("hour_entries")
        .select("*, employee:employees(*), job:jobs(*)")
        .eq("job_id", id)
        .order("work_date", { ascending: false }),
      supabase.from("employees").select("*").order("name", { ascending: true }),
      supabase.from("jobs").select("*").order("name", { ascending: true }),
    ]);

  if (!job) notFound();

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <DashboardHeader
        email={user.email ?? ""}
        subscriptionStatus="pro"
        businessType={profile?.business_type ?? "general"}
        logoPath={profile?.logo_url ?? null}
        active="jobs"
      />
      <main className="mx-auto w-full max-w-2xl flex-1 p-4">
        <Link
          href="/dashboard/jobs"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to jobs
        </Link>

        <div className="mb-6">
          <h1 className="text-2xl font-bold">{job.name}</h1>
        </div>

        <JobDetail
          job={job}
          initialReceipts={receipts ?? []}
          initialHourEntries={(hourEntries ?? []) as HourEntryWithRelations[]}
          employees={employees ?? []}
          jobs={jobs ?? []}
        />
      </main>
    </div>
  );
}
