import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { BackToDashboardLink } from "@/components/dashboard/back-to-dashboard-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ProgressBillingList, type ProgressJobSummary } from "@/components/jobs/progress-billing-list";
import { calculateJobRevenue } from "@/lib/job-revenue";
import { calculateInvoicedToDate, calculateRemainingBalance } from "@/lib/progress-billing";
import type { Client, Job, LineItem } from "@/lib/database.types";

export const metadata: Metadata = {
  title: "Progress Billing — TaxSnap",
};

// Pro-only, same all-or-nothing gate shape as dashboard/overview/page.tsx
// - a distinct, more advanced paid feature, not a capped-freemium one
// like the rest of invoicing/jobs. General-business only: progress
// billing is a general-contractor concept, salon has no analogue (same
// salon redirect precedent as Overview).
export default async function ProgressBillingPage() {
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

  let summaries: ProgressJobSummary[] = [];
  let eligibleJobs: Job[] = [];
  let allJobs: { id: string; name: string }[] = [];
  let clients: Client[] = [];
  let lineItems: LineItem[] = [];

  if (isPro) {
    const [{ data: jobs }, { data: clientRows }, { data: lineItemRows }] = await Promise.all([
      supabase.from("jobs").select("*").order("name", { ascending: true }),
      supabase.from("clients").select("*").order("name", { ascending: true }),
      supabase
        .from("line_items")
        .select("*")
        .eq("is_active", true)
        .order("description", { ascending: true }),
    ]);

    allJobs = jobs ?? [];
    clients = clientRows ?? [];
    lineItems = lineItemRows ?? [];

    const progressJobs = (jobs ?? []).filter((j) => j.contract_value !== null);
    eligibleJobs = (jobs ?? []).filter((j) => j.contract_value === null);

    if (progressJobs.length > 0) {
      const { data: documents } = await supabase
        .from("documents")
        .select(
          "id, job_id, type, document_number, status, issue_date, subtotal, total_amount, is_progress_draw, draw_number, payments(id, amount, paid_date)",
        )
        .eq("type", "invoice")
        .in(
          "job_id",
          progressJobs.map((j) => j.id),
        )
        .order("draw_number", { ascending: true });

      summaries = progressJobs.map((job) => {
        const jobDocs = (documents ?? []).filter((d) => d.job_id === job.id);
        // Received to date counts every invoice on the job, draws or
        // not (a stray non-draw invoice, e.g. a change order billed
        // separately, is still real money received for it) - same
        // reasoning calculateJobRevenue already uses on the Job Detail
        // page. Invoiced to date is narrower on purpose: only what's
        // been billed *as a draw* against the contract.
        const receivedToDate = calculateJobRevenue(jobDocs);
        const invoicedToDate = calculateInvoicedToDate(jobDocs);
        const remainingBalance = calculateRemainingBalance(
          job.contract_value ?? 0,
          invoicedToDate,
        );
        // The individual draws themselves - the summary numbers above
        // roll these up, but each one also needs its own link to its
        // invoice detail/PDF page (there was previously no way to open
        // a draw once created, only see it counted in the totals).
        const draws = jobDocs
          .filter((d) => d.is_progress_draw)
          .map((d) => ({
            id: d.id,
            documentNumber: d.document_number,
            drawNumber: d.draw_number,
            status: d.status,
            issueDate: d.issue_date,
            totalAmount: d.total_amount,
            // Per-draw received amount - distinct from receivedToDate
            // above, which rolls up every invoice on the job. This is
            // just this one draw's own payments.
            receivedAmount: d.payments.reduce((sum, p) => sum + p.amount, 0),
            // Individual payments, oldest first - when a draw has more
            // than one, the list shows each rather than only the summed
            // total (see progress-billing-list.tsx).
            payments: [...d.payments]
              .sort((a, b) => (a.paid_date < b.paid_date ? -1 : 1))
              .map((p) => ({ id: p.id, amount: p.amount, paidDate: p.paid_date })),
          }));
        return { job, invoicedToDate, receivedToDate, remainingBalance, draws };
      });
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <DashboardHeader
        email={user.email ?? ""}
        subscriptionStatus={profile?.subscription_status ?? "free"}
        businessType={profile?.business_type ?? "general"}
        logoPath={profile?.logo_url ?? null}
        active="progress-billing"
      />
      <main className="mx-auto w-full max-w-2xl flex-1 p-4">
        <BackToDashboardLink />

        <div className="mb-6">
          <h1 className="text-2xl font-bold">Progress Billing</h1>
          <p className="text-muted-foreground">
            Track draws against a job&apos;s contract value.
          </p>
        </div>

        {isPro ? (
          <ProgressBillingList
            initialSummaries={summaries}
            eligibleJobs={eligibleJobs}
            jobs={allJobs}
            clients={clients}
            lineItems={lineItems}
          />
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Lock className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="font-medium">Progress Billing is a Pro feature</p>
              <p className="max-w-xs text-sm text-muted-foreground">
                Upgrade to the Pro plan ($29/mo) to track draws against a
                contract value.
              </p>
              <Button nativeButton={false} render={<Link href="/billing" />}>
                Upgrade to Pro
              </Button>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
