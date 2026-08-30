import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { BackToDashboardLink } from "@/components/dashboard/back-to-dashboard-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StylistList } from "@/components/commission/stylist-list";
import { STYLIST_PUBLIC_COLUMNS } from "@/lib/stylist-columns";

export const metadata: Metadata = {
  title: "Stylists — TaxSnap",
};

export default async function StylistsPage() {
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

  const { data: stylists } = isPro
    ? await supabase.from("stylists").select(STYLIST_PUBLIC_COLUMNS).order("name", { ascending: true })
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
          <h1 className="text-2xl font-bold">Stylists</h1>
          <p className="text-muted-foreground">
            Manage stylists and their commission rate.
          </p>
        </div>

        {isPro ? (
          <StylistList initialStylists={stylists ?? []} />
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
