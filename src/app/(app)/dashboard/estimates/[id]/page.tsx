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
      "subscription_status, business_type, logo_url, business_name, business_address, business_phone, business_email",
    )
    .eq("id", user.id)
    .single();

  const [
    { data: document },
    { data: clients },
    { data: conversion },
    { data: jobs },
    { data: lineItems },
  ] = await Promise.all([
    supabase
      .from("documents")
      .select("*, client:clients(*), job:jobs(*), payments(*), items:document_items(*)")
      .eq("id", id)
      .eq("type", "estimate")
      .single(),
    supabase.from("clients").select("*").order("name", { ascending: true }),
    supabase
      .from("documents")
      .select("id")
      .eq("converted_from_id", id)
      .maybeSingle(),
    supabase
      .from("jobs")
      .select("id, name, contract_value")
      .order("name", { ascending: true }),
    supabase.from("line_items").select("*").eq("is_active", true).order("description", { ascending: true }),
  ]);

  if (!document) notFound();

  // Progress-billed jobs are excluded from the job picker - see the same
  // filter's comment in invoices/new/page.tsx. This document's own current
  // job (if any) stays visible even if progress-billed, so re-saving
  // without touching the job field doesn't silently clear it.
  const eligibleJobs = (jobs ?? []).filter(
    (j) => j.contract_value === null || j.id === document.job_id,
  );

  return (
    <DocumentDetail
      document={document as DocumentWithRelations}
      clients={clients ?? []}
      jobs={eligibleJobs}
      lineItems={lineItems ?? []}
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
