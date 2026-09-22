import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DocumentEditor } from "@/components/invoices/document-editor";

export const metadata: Metadata = {
  title: "New Estimate — TaxSnap",
};

export default async function NewEstimatePage() {
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
    supabase.from("jobs").select("id, name").order("name", { ascending: true }),
    supabase.from("line_items").select("*").eq("is_active", true).order("description", { ascending: true }),
  ]);

  return (
    <DocumentEditor
      defaultType="estimate"
      basePath="/dashboard/estimates"
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
