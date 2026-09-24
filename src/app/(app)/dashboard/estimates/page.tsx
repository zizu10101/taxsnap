import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/dashboard/page-header";
import { DocumentList } from "@/components/invoices/document-list";

export const metadata: Metadata = {
  title: "Estimates — TaxSnap",
};

// Estimates are unlimited/free at every tier (see src/lib/plan-limits.ts -
// only converting one to an invoice counts against the invoice cap) - this
// page was never meant to be Pro-only in the new model, so unlike
// Invoices/Jobs/Employees there's no cap to enforce here at all, just the
// same fetch-and-render every tier gets.
export default async function EstimatesPage() {
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

  const [{ data: documents }, { data: clients }] = await Promise.all([
    supabase
      .from("documents")
      .select("*, client:clients(*), job:jobs(*), payments(*), items:document_items(*)")
      .eq("type", "estimate")
      .order("issue_date", { ascending: false }),
    supabase.from("clients").select("*").order("name", { ascending: true }),
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
    <div className="mx-auto w-full max-w-2xl space-y-6 lg:max-w-none">
      <PageHeader
        backHref="/dashboard"
        title="Estimates"
        subtitle="Quote a job, then convert it to an invoice once it's approved."
        actions={
          <Link
            href="/dashboard/line-items"
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Saved items
          </Link>
        }
      />

      <DocumentList
        type="estimate"
        basePath="/dashboard/estimates"
        initialDocuments={documents ?? []}
        initialClients={clients ?? []}
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
      />
    </div>
  );
}
