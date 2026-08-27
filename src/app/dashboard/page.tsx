import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { DashboardBody } from "@/components/dashboard/dashboard-body";

export const metadata: Metadata = {
  title: "Dashboard — TaxSnap",
};

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth");
  }

  const [{ data: profile }, { data: receipts }, { data: jobs }] = await Promise.all([
    supabase
      .from("profiles")
      .select("subscription_status")
      .eq("id", user.id)
      .single(),
    supabase
      .from("receipts")
      .select("*")
      .order("transaction_date", { ascending: false }),
    // Job names for the receipt job picker - not Pro-gated (job tagging on
    // receipts is available on every tier), so this reads the jobs table
    // directly rather than going through the Pro-only /api/jobs route.
    supabase.from("jobs").select("name").order("name", { ascending: true }),
  ]);

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <DashboardHeader
        email={user.email ?? ""}
        subscriptionStatus={profile?.subscription_status ?? "free"}
      />
      <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 p-4">
        <DashboardBody
          initialReceipts={receipts ?? []}
          initialJobNames={(jobs ?? []).map((j) => j.name)}
        />
      </main>
    </div>
  );
}
