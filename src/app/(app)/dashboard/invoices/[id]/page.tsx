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

  if (profile?.subscription_status !== "pro") {
    redirect("/dashboard/invoices");
  }

  const [{ data: document }, { data: clients }] = await Promise.all([
    supabase
      .from("documents")
      .select("*, client:clients(*), payments(*), items:document_items(*)")
      .eq("id", id)
      .eq("type", "invoice")
      .single(),
    supabase.from("clients").select("*").order("name", { ascending: true }),
  ]);

  if (!document) notFound();

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <DashboardHeader
        email={user.email ?? ""}
        subscriptionStatus="pro"
        businessType={profile?.business_type ?? "general"}
        logoPath={profile?.logo_url ?? null}
        active="invoices"
      />
      <main className="flex-1">
        <DocumentDetail
          document={document as DocumentWithRelations}
          clients={clients ?? []}
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
