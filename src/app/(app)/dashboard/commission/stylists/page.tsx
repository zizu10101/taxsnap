import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BackToDashboardLink } from "@/components/dashboard/back-to-dashboard-link";
import { PageHeader } from "@/components/dashboard/page-header";
import { StylistList } from "@/components/commission/stylist-list";
import { STYLIST_PUBLIC_COLUMNS } from "@/lib/stylist-columns";

export const metadata: Metadata = {
  title: "Stylists — TaxSnap",
};

// No isPro gate here anymore - a free-tier salon account gets a capped
// preview (1 active stylist) rather than being locked out entirely. The
// cap itself is enforced server-side (POST /api/stylists, PATCH
// /api/stylists/[id] - see lib/plan-limits.ts); StylistDialog surfaces
// the resulting FREE_LIMIT_REACHED response as an upgrade prompt.
export default async function StylistsPage() {
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

  const { data: stylists } = await supabase
    .from("stylists")
    .select(STYLIST_PUBLIC_COLUMNS)
    .order("name", { ascending: true });

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <PageHeader
        back={<BackToDashboardLink />}
        title="Stylists"
        subtitle="Manage stylists and their commission rate."
      />

      <StylistList
        initialStylists={stylists ?? []}
        subscriptionStatus={profile?.subscription_status ?? "free"}
        isPro={profile?.subscription_status === "pro"}
      />
    </div>
  );
}
