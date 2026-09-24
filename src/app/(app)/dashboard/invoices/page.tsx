import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/dashboard/page-header";
import { DocumentList } from "@/components/invoices/document-list";

export const metadata: Metadata = {
  title: "Invoices — TaxSnap",
};

// Invoicing is capped, not Pro-only, at every tier now (3/10/unlimited
// invoices per month - see src/lib/plan-limits.ts). Every tier fetches and
// renders the real list; the cap only bites in DocumentList's own create
// flow when POST /api/documents returns FREE_LIMIT_REACHED.
export default async function InvoicesPage() {
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
      .eq("type", "invoice")
      .order("issue_date", { ascending: false }),
    supabase.from("clients").select("*").order("name", { ascending: true }),
  ]);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 lg:max-w-none">
      <PageHeader
        backHref="/dashboard"
        title="Invoices"
        subtitle="Bill your clients directly from TaxSnap."
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
        type="invoice"
        basePath="/dashboard/invoices"
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
      />
    </div>
  );
}
