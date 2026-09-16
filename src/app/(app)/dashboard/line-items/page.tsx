import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { BackToDashboardLink } from "@/components/dashboard/back-to-dashboard-link";
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
    <div className="flex min-h-screen flex-col bg-muted/30">
      <DashboardHeader
        email={user.email ?? ""}
        subscriptionStatus={profile?.subscription_status ?? "free"}
        businessType={profile?.business_type ?? "general"}
        logoPath={profile?.logo_url ?? null}
        active="invoices"
      />
      <main className="mx-auto w-full max-w-2xl flex-1 p-4">
        <BackToDashboardLink />

        <div className="mb-6">
          <h1 className="text-2xl font-bold">Saved Items</h1>
          <p className="text-muted-foreground">
            Reusable line items you can pick from when building an invoice
            or estimate.
          </p>
        </div>

        <LineItemList
          initialLineItems={lineItems ?? []}
          subscriptionStatus={profile?.subscription_status ?? "free"}
        />
      </main>
    </div>
  );
}
