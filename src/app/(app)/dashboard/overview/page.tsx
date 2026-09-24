import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { BackToDashboardLink } from "@/components/dashboard/back-to-dashboard-link";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ExpenseOverview } from "@/components/dashboard/expense-overview";
import { getExpenseOverviewData } from "@/lib/expense-overview-query";
import { getPresetRange } from "@/lib/date-range";

export const metadata: Metadata = {
  title: "Overview — TaxSnap",
};

// General-business analogue of dashboard/commission/overview/page.tsx -
// same all-or-nothing Pro gate shape as Jobs/Employees. A salon account
// hitting this URL directly redirects to /dashboard rather than rendering
// - this is built entirely on receipts/expense data a salon account
// already sees in its own HST summary card on the main dashboard, and the
// nav entry point (the sidebar/bottom-nav shell in dashboard/layout.tsx) is
// hidden for salon in the first place, same precedent as Commission
// Overview redirecting non-salon.
export default async function ExpenseOverviewPage() {
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

  if (profile?.business_type === "salon") {
    redirect("/dashboard");
  }

  const isPro = profile?.subscription_status === "pro";

  // Plain inclusive "YYYY-MM-DD" bounds, not rangeToUtcBounds - see
  // getExpenseOverviewData's own comment. Mirrors this same preset so the
  // initial render and a client-side range change hit the query with
  // identically-shaped bounds.
  const defaultRange = getPresetRange("this-month");
  const initialRangeData = isPro
    ? await getExpenseOverviewData(supabase, defaultRange.start, defaultRange.end)
    : null;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 lg:max-w-none">
      <PageHeader
        back={<BackToDashboardLink />}
        title="Overview"
        subtitle="Expense and write-off totals over time."
      />

      {isPro && initialRangeData ? (
        <ExpenseOverview initialRangeData={initialRangeData} />
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Lock className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="font-medium">Overview is a Pro feature</p>
            <p className="max-w-xs text-sm text-muted-foreground">
              Upgrade to the Pro plan ($29/mo) to see expense and
              write-off totals over time.
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
