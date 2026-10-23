import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { BackToDashboardLink } from "@/components/dashboard/back-to-dashboard-link";
import { PageHeader } from "@/components/dashboard/page-header";
import { HowThisWorks } from "@/components/ui/how-this-works";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ReportsView } from "@/components/reports/reports-view";
import { getJobSummary, getReportsData } from "@/lib/reports-query";
import { getPresetRange } from "@/lib/date-range";
import { UpgradeCard } from "@/components/billing/upgrade-card";

export const metadata: Metadata = {
  title: "Reports — TaxSnap",
};

// Same all-or-nothing Pro gate and salon redirect as Overview - built on the
// receipts/payments data a general business already has, hidden from salon
// accounts at the nav level too.
export default async function ReportsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth");

  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_status, business_type")
    .eq("id", user.id)
    .single();

  if (profile?.business_type === "salon") {
    redirect("/dashboard");
  }

  const isPro = profile?.subscription_status === "pro";

  // Plain inclusive "YYYY-MM-DD" bounds, mirroring ReportsView's own default
  // preset so the first paint and a client-side refetch agree.
  const defaultRange = getPresetRange("this-month");
  // The Job Summary has its own range, defaulting to all time (no bounds).
  const [initialData, initialJobs] = isPro
    ? await Promise.all([
        getReportsData(supabase, defaultRange.start, defaultRange.end),
        getJobSummary(supabase, null, null),
      ])
    : [null, null];

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 lg:max-w-none">
      <PageHeader
        back={<BackToDashboardLink />}
        title="Reports"
        subtitle="Profit & loss, job summary, expenses by category, vendor and revenue."
      />

      {isPro && initialData && initialJobs && <HowThisWorks tab="reports" userId={user.id} empty={false} />}

      {isPro && initialData && initialJobs ? (
        <ReportsView initialData={initialData} initialJobs={initialJobs} />
      ) : (
        <UpgradeCard feature="Reports" message="Upgrade to Pro for profit &amp; loss, a job summary and expenses by category." />
      )}
    </div>
  );
}
