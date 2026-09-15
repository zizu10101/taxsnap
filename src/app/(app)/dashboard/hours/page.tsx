import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { HoursList } from "@/components/hours/hours-list";
import type { HourEntryWithRelations } from "@/lib/database.types";

export const metadata: Metadata = {
  title: "Hours — TaxSnap",
};

// Hours themselves are never capped at any tier (see src/lib/plan-limits.ts
// - only the employee they're logged against is) - this page was already
// reachable through Jobs/Employees for a Pro account, so it just drops the
// old all-or-nothing Pro gate rather than needing any new cap logic here.
export default async function HoursPage() {
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

  const [{ data: entries }, { data: employees }, { data: jobs }] = await Promise.all([
    supabase
      .from("hour_entries")
      .select("*, employee:employees(*), job:jobs(*)")
      .order("work_date", { ascending: false }),
    supabase.from("employees").select("*").order("name", { ascending: true }),
    supabase.from("jobs").select("*").order("name", { ascending: true }),
  ]);

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <DashboardHeader
        email={user.email ?? ""}
        subscriptionStatus={profile?.subscription_status ?? "free"}
        businessType={profile?.business_type ?? "general"}
        logoPath={profile?.logo_url ?? null}
        active="jobs"
      />
      <main className="mx-auto w-full max-w-2xl flex-1 p-4">
        <Link
          href="/dashboard"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Link>

        <div className="mb-6">
          <h1 className="text-2xl font-bold">Hours</h1>
          <p className="text-muted-foreground">
            Log hours worked per employee, per job.
          </p>
        </div>

        <HoursList
          initialEntries={(entries ?? []) as HourEntryWithRelations[]}
          initialEmployees={employees ?? []}
          initialJobs={jobs ?? []}
        />
      </main>
    </div>
  );
}
