import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/dashboard/page-header";
import { ClientDetail } from "@/components/clients/client-detail";
import { buildClientSummaries } from "@/lib/client-summary";

export const metadata: Metadata = {
  title: "Client — TaxSnap",
};

export default async function ClientDetailPage({
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

  const [{ data: client }, { data: documents }] = await Promise.all([
    supabase.from("clients").select("*").eq("id", id).single(),
    supabase
      .from("documents")
      .select("id, client_id, type, status, document_number, issue_date, total_amount, payments(amount)")
      .eq("client_id", id)
      .order("issue_date", { ascending: false }),
  ]);

  if (!client) notFound();

  const summary = buildClientSummaries([id], documents ?? []).get(id)!;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 lg:max-w-none">
      <PageHeader
        eyebrow="Client"
        title={client.name}
        subtitle={`${summary.invoiceCount} invoice${summary.invoiceCount === 1 ? "" : "s"}`}
        backHref="/dashboard/clients"
        backLabel="Back to clients"
      />

      <ClientDetail initialClient={client} summary={summary} documents={documents ?? []} />
    </div>
  );
}
