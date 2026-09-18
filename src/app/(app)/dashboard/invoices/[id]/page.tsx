import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { DocumentDetail } from "@/components/invoices/document-detail";
import type { DocumentWithRelations } from "@/lib/database.types";

export const metadata: Metadata = {
  title: "Invoice — TaxSnap",
};

export default async function InvoiceDetailPage({
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
    .select(
      "subscription_status, business_type, logo_url, business_name, business_address, business_phone, business_email",
    )
    .eq("id", user.id)
    .single();

  const [{ data: document }, { data: clients }, { data: jobs }, { data: lineItems }] =
    await Promise.all([
      supabase
        .from("documents")
        .select("*, client:clients(*), job:jobs(*), payments(*), items:document_items(*)")
        .eq("id", id)
        .eq("type", "invoice")
        .single(),
      supabase.from("clients").select("*").order("name", { ascending: true }),
      supabase.from("jobs").select("id, name").order("name", { ascending: true }),
      supabase.from("line_items").select("*").eq("is_active", true).order("description", { ascending: true }),
    ]);

  if (!document) notFound();

  // Only fetched when actually needed - depends on this document's own
  // job_id, so it can't join the parallel fetch above. Every *other*
  // draw on the same job, for the "Previous Billed" figure (see
  // lib/progress-billing.ts / generateDocumentPdf's own comment).
  let priorDraws: { draw_number: number | null; subtotal: number }[] = [];
  if (document.is_progress_draw && document.job_id) {
    const { data } = await supabase
      .from("documents")
      .select("draw_number, subtotal")
      .eq("job_id", document.job_id)
      .eq("is_progress_draw", true)
      .neq("id", document.id);
    priorDraws = data ?? [];
  }

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <DashboardHeader
        email={user.email ?? ""}
        subscriptionStatus={profile?.subscription_status ?? "free"}
        businessType={profile?.business_type ?? "general"}
        logoPath={profile?.logo_url ?? null}
        active="invoices"
      />
      <main className="flex-1">
        <DocumentDetail
          document={document as DocumentWithRelations}
          clients={clients ?? []}
          jobs={jobs ?? []}
          lineItems={lineItems ?? []}
          priorDraws={priorDraws}
          business={{
            name: profile?.business_name ?? null,
            email: profile?.business_email || user.email || "",
            phone: profile?.business_phone ?? null,
            address: profile?.business_address ?? null,
          }}
          logoPath={profile?.logo_url ?? null}
          basePath="/dashboard/invoices"
        />
      </main>
    </div>
  );
}
