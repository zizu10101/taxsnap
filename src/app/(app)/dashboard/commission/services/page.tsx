import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { BackToDashboardLink } from "@/components/dashboard/back-to-dashboard-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ServiceList } from "@/components/commission/service-list";

export const metadata: Metadata = {
  title: "Services — TaxSnap",
};

export default async function ServicesPage() {
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

  const isPro = profile?.subscription_status === "pro";

  const { data: services } = isPro
    ? await supabase.from("services").select("*").order("name", { ascending: true })
    : { data: null };

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <DashboardHeader
        email={user.email ?? ""}
        subscriptionStatus={profile?.subscription_status ?? "free"}
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

        {isPro ? (
          <ServiceList initialServices={services ?? []} />
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Lock className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="font-medium">Commission tracking is a Pro feature</p>
              <p className="max-w-xs text-sm text-muted-foreground">
                Upgrade to the Pro plan ($29/mo) to log and report per-stylist
                commissions.
              </p>
              <Button nativeButton={false} render={<Link href="/billing" />}>
                Upgrade to Pro
              </Button>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
