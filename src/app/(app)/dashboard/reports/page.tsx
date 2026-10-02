import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { BackToDashboardLink } from "@/components/dashboard/back-to-dashboard-link";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ReportsView } from "@/components/reports/reports-view";
import { getJobSummary, getReportsData } from "@/lib/reports-query";
import { getPresetRange } from "@/lib/date-range";

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
        subtitle="Profit & loss, job summary and expenses by category."
      />

      {isPro && initialData && initialJobs ? (
        <ReportsView initialData={initialData} initialJobs={initialJobs} />
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Lock className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="font-medium">Reports are a Pro feature</p>
            <p className="max-w-xs text-sm text-muted-foreground">
              Upgrade to the Pro plan ($29/mo) for profit &amp; loss, a job summary and expenses by
              category.
            </p>
            <Button nativeButton={false} render={<Link href="/billing" />}>
              Upgrade to Pro
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
