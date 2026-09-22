import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/dashboard/page-header";
import { JobDetail } from "@/components/jobs/job-detail";
import { calculateJobRevenue } from "@/lib/job-revenue";
import type { DocumentWithClient, HourEntryWithRelations } from "@/lib/database.types";

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

  const [
    { data: job },
    { data: receipts },
    { data: hourEntries },
    { data: employees },
    { data: jobs },
    { data: linkedDocuments },
    { data: clients },
    { data: lineItems },
  ] = await Promise.all([
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
    supabase
      .from("documents")
      .select("*, client:clients(*), payments(*)")
      .eq("job_id", id)
      .order("issue_date", { ascending: false }),
    supabase.from("clients").select("*").order("name", { ascending: true }),
    supabase
      .from("line_items")
      .select("*")
      .eq("is_active", true)
      .order("description", { ascending: true }),
  ]);

  if (!job) notFound();

  const documents = (linkedDocuments ?? []) as unknown as DocumentWithClient[];
  const invoiceCount = documents.filter((d) => d.type === "invoice").length;
  const jobRevenue = calculateJobRevenue(documents);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <PageHeader
        eyebrow="Job"
        title={job.name}
        subtitle={`${invoiceCount} linked invoice${invoiceCount === 1 ? "" : "s"}`}
        backHref="/dashboard/jobs"
        backLabel="Back to jobs"
      />

      <JobDetail
        job={job}
        initialReceipts={receipts ?? []}
        initialHourEntries={(hourEntries ?? []) as HourEntryWithRelations[]}
        employees={employees ?? []}
        jobs={jobs ?? []}
        clients={clients ?? []}
        savedLineItems={lineItems ?? []}
        linkedInvoiceCount={invoiceCount}
        jobRevenue={jobRevenue}
      />
    </div>
  );
}
