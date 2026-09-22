import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BackToDashboardLink } from "@/components/dashboard/back-to-dashboard-link";
import { PageHeader } from "@/components/dashboard/page-header";
import { ServiceList } from "@/components/commission/service-list";

export const metadata: Metadata = {
  title: "Services — TaxSnap",
};

// No isPro gate here anymore - a free-tier salon account gets a capped
// preview (1 active service) rather than being locked out entirely. The
// cap itself is enforced server-side (POST /api/services, PATCH
// /api/services/[id] - see lib/plan-limits.ts); ServiceDialog surfaces
// the resulting FREE_LIMIT_REACHED response as an upgrade prompt.
export default async function ServicesPage() {
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

  const { data: services } = await supabase
    .from("services")
    .select("*")
    .order("name", { ascending: true });

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <PageHeader
        back={<BackToDashboardLink />}
        title="Services"
        subtitle="Manage the services stylists can log commission against."
      />

      <ServiceList
        initialServices={services ?? []}
        subscriptionStatus={profile?.subscription_status ?? "free"}
        isPro={profile?.subscription_status === "pro"}
      />
    </div>
  );
}
