import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/dashboard/page-header";
import { ClientList } from "@/components/clients/client-list";
import { buildClientSummaries } from "@/lib/client-summary";
import type { ClientHistoryDoc } from "@/components/clients/client-workstation";

export const metadata: Metadata = {
  title: "Clients — TaxSnap",
};

const RECENT_DOCS_PER_CLIENT = 5;

// Clients is capped, not Pro-only, at every tier (see
// src/lib/plan-limits.ts) - same shape as JobsPage: every tier fetches and
// renders the real list, the cap only bites in ClientList's own create
// flow when POST /api/clients returns FREE_LIMIT_REACHED.
export default async function ClientsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth");

  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_status")
    .eq("id", user.id)
    .single();

  const [{ data: clients }, { data: documents }] = await Promise.all([
    supabase.from("clients").select("*").order("name", { ascending: true }),
    supabase
      .from("documents")
      .select("id, client_id, type, status, document_number, issue_date, total_amount, payments(amount)")
      .not("client_id", "is", null)
      .order("issue_date", { ascending: false }),
  ]);

  const clientIds = (clients ?? []).map((c) => c.id);
  const summaries = buildClientSummaries(clientIds, documents ?? []);

  // Every client's most recent few invoices/estimates, computed once here
  // so the lg+ workstation's live preview (see ClientWorkstation) can
  // switch between clients instantly instead of fetching per click - same
  // reasoning as buildJobCostSummaries in lib/job-revenue.ts. documents is
  // already sorted newest-first, so slicing per client preserves order.
  const recentDocsByClient: Record<string, ClientHistoryDoc[]> = {};
  for (const doc of documents ?? []) {
    if (!doc.client_id) continue;
    const list = recentDocsByClient[doc.client_id] ?? [];
    if (list.length < RECENT_DOCS_PER_CLIENT) {
      list.push({
        id: doc.id,
        type: doc.type,
        status: doc.status,
        document_number: doc.document_number,
        issue_date: doc.issue_date,
        total_amount: doc.total_amount,
      });
    }
    recentDocsByClient[doc.client_id] = list;
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 lg:max-w-none">
      <PageHeader
        backHref="/dashboard"
        title="Clients"
        subtitle="Every client's invoice history in one place."
      />

      <ClientList
        initialClients={clients ?? []}
        subscriptionStatus={profile?.subscription_status ?? "free"}
        summaries={Object.fromEntries(summaries)}
        recentDocsByClient={recentDocsByClient}
      />
    </div>
  );
}
