import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BackToDashboardLink } from "@/components/dashboard/back-to-dashboard-link";
import { PageHeader } from "@/components/dashboard/page-header";
import { RentalsClient } from "@/components/rentals/rentals-client";

export const metadata: Metadata = {
  title: "Chair Rental — TaxSnap",
};

// Nested under /dashboard/commission - reuses that section's existing
// CommissionLayout salon-only gate rather than a separate business_type
// check, even though renters are structurally unconnected to
// stylists/Commission/Register (see 0037_chair_rental.sql). Same
// no-Pro-gate shape as Services/Products/Stylists - every tier gets a
// capped preview (see lib/plan-limits.ts's activeRenters).
export default async function RentalsPage() {
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

  const { data: renters } = await supabase
    .from("renters")
    .select("*")
    .order("name", { ascending: true });

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <PageHeader
        back={<BackToDashboardLink />}
        title="Chair Rental"
        subtitle="Track renters and log their rent payments - private record-keeping only."
      />

      <RentalsClient
        initialRenters={renters ?? []}
        subscriptionStatus={profile?.subscription_status ?? "free"}
        isPro={profile?.subscription_status === "pro"}
      />
    </div>
  );
}
