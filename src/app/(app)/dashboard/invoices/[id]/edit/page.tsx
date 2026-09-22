import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DocumentEditor } from "@/components/invoices/document-editor";
import type { DocumentWithRelations } from "@/lib/database.types";

export const metadata: Metadata = {
  title: "Edit Invoice — TaxSnap",
};

export default async function EditInvoicePage({
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
    .select("logo_url, business_name, business_address, business_phone, business_email")
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

  // Progress draws have no full-page editor - locked job, draw
  // description, and % complete fields have no design reference (see
  // document-editor.tsx's own comment). They still edit through the
  // original DocumentBuilder dialog from the detail page's Edit button.
  if (document.is_progress_draw) {
    redirect(`/dashboard/invoices/${id}`);
  }

  return (
    <DocumentEditor
      defaultType="invoice"
      document={document as DocumentWithRelations}
      basePath="/dashboard/invoices"
      clients={clients ?? []}
      jobs={jobs ?? []}
      savedLineItems={lineItems ?? []}
      business={{
        name: profile?.business_name ?? null,
        email: profile?.business_email || user.email || "",
        phone: profile?.business_phone ?? null,
        address: profile?.business_address ?? null,
      }}
      logoPath={profile?.logo_url ?? null}
    />
  );
}
