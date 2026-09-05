import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
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

  if (profile?.subscription_status !== "pro") {
    redirect("/dashboard/estimates");
  }

  const [{ data: document }, { data: clients }, { data: conversion }, { data: jobs }] =
    await Promise.all([
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
      supabase.from("jobs").select("name").order("name", { ascending: true }),
    ]);

  if (!document) notFound();

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <DashboardHeader
        email={user.email ?? ""}
        subscriptionStatus="pro"
        businessType={profile?.business_type ?? "general"}
        logoPath={profile?.logo_url ?? null}
        active="estimates"
      />
      <main className="flex-1">
        <DocumentDetail
          document={document as DocumentWithRelations}
          clients={clients ?? []}
          jobs={(jobs ?? []).map((j) => j.name)}
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
      </main>
    </div>
  );
}
