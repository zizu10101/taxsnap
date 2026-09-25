import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DocumentEditor } from "@/components/invoices/document-editor";

export const metadata: Metadata = {
  title: "New Invoice — TaxSnap",
};

export default async function NewInvoicePage() {
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

  const [{ data: clients }, { data: jobs }, { data: lineItems }] = await Promise.all([
    supabase.from("clients").select("*").order("name", { ascending: true }),
    // Progress-billed jobs are excluded - once a job has a contract_value,
    // it should only ever be invoiced through its draw schedule (see
    // progress-billing-summary.tsx). A plain invoice tagged to it here
    // would count toward the Progress Billing Summary's Received/Remaining
    // totals (job-revenue.ts sums every invoice on the job, draw or not)
    // without ever showing up in the draw list.
    supabase
      .from("jobs")
      .select("id, name")
      .is("contract_value", null)
      .order("name", { ascending: true }),
    supabase.from("line_items").select("*").eq("is_active", true).order("description", { ascending: true }),
  ]);

  return (
    <DocumentEditor
      defaultType="invoice"
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
