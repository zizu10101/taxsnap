import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { ProgressBillingSummary } from "@/components/jobs/progress-billing-summary";
import { calculateJobRevenue } from "@/lib/job-revenue";
import { calculateInvoicedToDate, calculateRemainingBalance } from "@/lib/progress-billing";

export const metadata: Metadata = {
  title: "Progress Billing Summary — TaxSnap",
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// The "master document" for a progress-billed job - one place showing
// the whole draw history (every draw, its own payments, running
// received/remaining) rather than piecing it together by opening each
// draw's invoice individually. Same Pro/salon gate as the parent tab.
export default async function ProgressBillingSummaryPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
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

  if (profile?.subscription_status !== "pro" || profile?.business_type === "salon") {
    redirect("/dashboard/progress-billing");
  }

  const { data: job } = await supabase
    .from("jobs")
    .select("id, name, contract_value, contract_number")
    .eq("id", jobId)
    .eq("user_id", user.id)
    .single();

  if (!job || job.contract_value === null) notFound();
  const contractValue = job.contract_value;

  // Documents alongside clients/jobs/line_items - the latter three are
  // only needed for the DocumentBuilder that "Bill Remaining Balance"
  // opens (same requirements as the parent tab's own New Draw), not for
  // the read-only summary itself.
  const [
    { data: documents },
    { data: allJobs },
    { data: clientRows },
    { data: lineItemRows },
    { data: contractChanges },
  ] = await Promise.all([
    supabase
      .from("documents")
      .select(
        "id, document_number, status, issue_date, subtotal, total_amount, is_progress_draw, draw_number, draw_description, draw_percent_complete, payments(id, amount, paid_date)",
      )
      .eq("type", "invoice")
      .eq("job_id", jobId)
      .order("draw_number", { ascending: true }),
    supabase.from("jobs").select("id, name").order("name", { ascending: true }),
    supabase.from("clients").select("*").order("name", { ascending: true }),
    supabase
      .from("line_items")
      .select("*")
      .eq("is_active", true)
      .order("description", { ascending: true }),
    supabase
      .from("contract_changes")
      .select(
        "*, items:contract_change_items(*), billed_document:documents(id, document_number, draw_number)",
      )
      .eq("job_id", jobId)
      .order("changed_at", { ascending: false }),
  ]);

  const jobDocs = documents ?? [];
  const invoicedToDate = calculateInvoicedToDate(jobDocs);
  const receivedToDate = calculateJobRevenue(
    jobDocs.map((d) => ({ ...d, type: "invoice" as const })),
  );
  const remainingBalance = calculateRemainingBalance(contractValue, receivedToDate);

  // Running Received/Remaining - accumulated draw by draw (in draw
  // order), not including a stray non-draw invoice on the job (there's
  // no well-defined place in a draw sequence to slot one in). The
  // top-level receivedToDate/remainingBalance above still count it, same
  // as the Progress Billing tab's own job summary. Built as a pure
  // reduce (no mutated accumulator variable) since this runs inside a
  // component function body.
  const progressDraws = jobDocs.filter((d) => d.is_progress_draw);
  const runningReceivedByIndex = progressDraws.reduce<number[]>((acc, d) => {
    const receivedAmount = round2(d.payments.reduce((sum, p) => sum + p.amount, 0));
    const prior = acc.length > 0 ? acc[acc.length - 1] : 0;
    return [...acc, round2(prior + receivedAmount)];
  }, []);
  const draws = progressDraws.map((d, i) => {
    const runningReceivedToDate = runningReceivedByIndex[i];
    return {
      id: d.id,
      documentNumber: d.document_number,
      drawNumber: d.draw_number,
      status: d.status,
      issueDate: d.issue_date,
      totalAmount: d.total_amount,
      description: d.draw_description,
      percentComplete: d.draw_percent_complete,
      receivedAmount: round2(d.payments.reduce((sum, p) => sum + p.amount, 0)),
      payments: [...d.payments]
        .sort((a, b) => (a.paid_date < b.paid_date ? -1 : 1))
        .map((p) => ({ id: p.id, amount: p.amount, paidDate: p.paid_date })),
      runningReceivedToDate,
      runningRemainingBalance: round2(contractValue - runningReceivedToDate),
    };
  });

  const changes = (contractChanges ?? []).map((c) => ({
    id: c.id,
    reason: c.reason,
    amount: c.amount,
    changedAt: c.changed_at,
    items: c.items.map((i) => ({
      description: i.description,
      quantity: i.quantity,
      unit_price: i.unit_price,
    })),
    billedDocumentId: c.billed_document_id,
    billedDocumentNumber: c.billed_document?.document_number ?? null,
    billedDrawNumber: c.billed_document?.draw_number ?? null,
  }));

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <DashboardHeader
        email={user.email ?? ""}
        subscriptionStatus={profile?.subscription_status ?? "free"}
        businessType={profile?.business_type ?? "general"}
        logoPath={profile?.logo_url ?? null}
        active="progress-billing"
      />
      <main className="flex-1">
        <ProgressBillingSummary
          job={{ id: job.id, name: job.name, contractValue, contractNumber: job.contract_number }}
          invoicedToDate={invoicedToDate}
          receivedToDate={receivedToDate}
          remainingBalance={remainingBalance}
          draws={draws}
          changes={changes}
          jobs={allJobs ?? []}
          clients={clientRows ?? []}
          lineItems={lineItemRows ?? []}
        />
      </main>
    </div>
  );
}
