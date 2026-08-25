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
    .select(
      "subscription_status, logo_url, business_name, business_address, business_phone, business_email",
    )
    .eq("id", user.id)
    .single();

  if (profile?.subscription_status !== "pro") {
    redirect("/dashboard/estimates");
  }

  const [{ data: document }, { data: clients }, { data: conversion }] =
    await Promise.all([
      supabase
        .from("documents")
        .select("*, client:clients(*), payments(*), items:document_items(*)")
        .eq("id", id)
        .eq("type", "estimate")
        .single(),
      supabase.from("clients").select("*").order("name", { ascending: true }),
      supabase
        .from("documents")
        .select("id")
        .eq("converted_from_id", id)
        .maybeSingle(),
    ]);

  if (!document) notFound();

  return (
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
      basePath="/dashboard/estimates"
      convertedToInvoiceId={conversion?.id ?? null}
    />
  );
}
