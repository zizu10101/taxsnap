import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BackToDashboardLink } from "@/components/dashboard/back-to-dashboard-link";
import { PageHeader } from "@/components/dashboard/page-header";
import { LineItemList } from "@/components/invoices/line-item-list";

export const metadata: Metadata = {
  title: "Saved Items — TaxSnap",
};

// General-business analogue of dashboard/commission/services/page.tsx -
// same capped-preview shape (no hard Pro gate, active items capped per
// tier - see lib/plan-limits.ts), just for general-business invoicing's
// reusable line items instead of the salon Commission catalog.
export default async function LineItemsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth");

  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_status, business_type, logo_url")
    .eq("id", user.id)
    .single();

  const { data: lineItems } = await supabase
    .from("line_items")
    .select("*")
    .order("description", { ascending: true });

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 lg:max-w-none">
      <PageHeader
        back={<BackToDashboardLink />}
        title="Saved Items"
        subtitle="Reusable line items you can pick from when building an invoice or estimate."
      />

      <LineItemList
        initialLineItems={lineItems ?? []}
        subscriptionStatus={profile?.subscription_status ?? "free"}
      />
    </div>
  );
}
