import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { BackToDashboardLink } from "@/components/dashboard/back-to-dashboard-link";
import { ServiceList } from "@/components/commission/service-list";

export const metadata: Metadata = {
  title: "Services — TaxSnap",
};

// No isPro gate here anymore - a free-tier salon account gets a capped
// preview (1 active service) rather than being locked out entirely. The
// cap itself is enforced server-side (POST /api/services, PATCH
// /api/services/[id] - see lib/free-tier-limits.ts); ServiceDialog surfaces
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
    <div className="flex min-h-screen flex-col bg-muted/30">
      <DashboardHeader
        email={user.email ?? ""}
        subscriptionStatus={profile?.subscription_status ?? "free"}
        businessType={profile?.business_type ?? "general"}
        logoPath={profile?.logo_url ?? null}
        active="commission"
      />
      <main className="mx-auto w-full max-w-2xl flex-1 p-4">
        <BackToDashboardLink />

        <div className="mb-6">
          <h1 className="text-2xl font-bold">Services</h1>
          <p className="text-muted-foreground">
            Manage the services stylists can log commission against.
          </p>
        </div>

        <ServiceList
          initialServices={services ?? []}
          isPro={profile?.subscription_status === "pro"}
        />
      </main>
    </div>
  );
}
