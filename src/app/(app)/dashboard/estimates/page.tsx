import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { DocumentList } from "@/components/invoices/document-list";

export const metadata: Metadata = {
  title: "Estimates — TaxSnap",
};

// Estimates are unlimited/free at every tier (see src/lib/plan-limits.ts -
// only converting one to an invoice counts against the invoice cap) - this
// page was never meant to be Pro-only in the new model, so unlike
// Invoices/Jobs/Employees there's no cap to enforce here at all, just the
// same fetch-and-render every tier gets.
export default async function EstimatesPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const { new: newParam } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth");

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "subscription_status, business_type, logo_url, business_name, business_address, business_phone, business_email, business_profile_skipped",
    )
    .eq("id", user.id)
    .single();

  const [{ data: documents }, { data: clients }, { data: jobs }, { data: lineItems }] =
    await Promise.all([
      supabase
        .from("documents")
        .select("*, client:clients(*), job:jobs(*), payments(*)")
        .eq("type", "estimate")
        .order("issue_date", { ascending: false }),
      supabase.from("clients").select("*").order("name", { ascending: true }),
      supabase.from("jobs").select("name").order("name", { ascending: true }),
      supabase.from("line_items").select("*").eq("is_active", true).order("description", { ascending: true }),
    ]);

  let convertedMap: Record<string, string> = {};
  if (documents?.length) {
    const estimateIds = documents.map((d) => d.id);
    const { data: conversions } = await supabase
      .from("documents")
      .select("id, converted_from_id")
      .in("converted_from_id", estimateIds);
    convertedMap = Object.fromEntries(
      (conversions ?? []).map((c) => [c.converted_from_id as string, c.id]),
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <DashboardHeader
        email={user.email ?? ""}
        subscriptionStatus={profile?.subscription_status ?? "free"}
        businessType={profile?.business_type ?? "general"}
        logoPath={profile?.logo_url ?? null}
        active="estimates"
      />
      <main className="mx-auto w-full max-w-2xl flex-1 p-4">
        <Link
          href="/dashboard"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Link>

        <div className="mb-6 flex items-start justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold">Estimates</h1>
            <p className="text-muted-foreground">
              Quote a job, then convert it to an invoice once it&apos;s
              approved.
            </p>
          </div>
          <Link
            href="/dashboard/line-items"
            className="mt-1 shrink-0 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Saved items
          </Link>
        </div>

        <DocumentList
          type="estimate"
          basePath="/dashboard/estimates"
          initialDocuments={documents ?? []}
          initialClients={clients ?? []}
          initialJobs={(jobs ?? []).map((j) => j.name)}
          initialLineItems={lineItems ?? []}
          businessType={profile?.business_type ?? "general"}
          subscriptionStatus={profile?.subscription_status ?? "free"}
          initialProfile={{
            logo_url: profile?.logo_url ?? null,
            business_name: profile?.business_name ?? null,
            business_address: profile?.business_address ?? null,
            business_phone: profile?.business_phone ?? null,
            business_email: profile?.business_email ?? null,
            business_profile_skipped: profile?.business_profile_skipped ?? false,
          }}
          convertedMap={convertedMap}
          autoOpenNew={newParam === "1"}
        />
      </main>
    </div>
  );
}
