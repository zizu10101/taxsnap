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

  const [{ data: profile }, { data: receipts }] = await Promise.all([
    supabase
      .from("profiles")
      .select("subscription_status")
      .eq("id", user.id)
      .single(),
    supabase
      .from("receipts")
      .select("*")
      .order("transaction_date", { ascending: false }),
  ]);

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <DashboardHeader
        email={user.email ?? ""}
        subscriptionStatus={profile?.subscription_status ?? "free"}
      />
      <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 p-4">
        <DashboardBody initialReceipts={receipts ?? []} />
      </main>
    </div>
  );
}
