import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DocumentDetail } from "@/components/invoices/document-detail";
import type { DocumentWithRelations } from "@/lib/database.types";

export const metadata: Metadata = {
  title: "Estimate — TaxSnap",
};

export default async function EstimateDetailPage({
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
    .select("subscription_status, logo_url")
    .eq("id", user.id)
    .single();

  if (profile?.subscription_status !== "pro") {
    redirect("/dashboard/estimates");
  }

  const [{ data: document }, { data: clients }] = await Promise.all([
    supabase
      .from("documents")
      .select("*, client:clients(*), items:document_items(*)")
      .eq("id", id)
      .eq("type", "estimate")
      .single(),
    supabase.from("clients").select("*").order("name", { ascending: true }),
  ]);

  if (!document) notFound();

  return (
    <DocumentDetail
      document={document as DocumentWithRelations}
      clients={clients ?? []}
      fromEmail={user.email ?? ""}
      logoPath={profile?.logo_url ?? null}
      basePath="/dashboard/estimates"
    />
  );
}
