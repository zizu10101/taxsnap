import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { EmployeeList } from "@/components/employees/employee-list";

export const metadata: Metadata = {
  title: "Employees — TaxSnap",
};

// Employees is capped, not Pro-only, at every tier now (1/5/unlimited
// active - see src/lib/plan-limits.ts) - every tier fetches and renders
// the real list, the cap only bites in EmployeeList's own create/reactivate
// flow when it hits the FREE_LIMIT_REACHED response.
export default async function EmployeesPage() {
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

  const { data: employees } = await supabase
    .from("employees")
    .select("*")
    .order("name", { ascending: true });

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
          <h1 className="text-2xl font-bold">Employees</h1>
          <p className="text-muted-foreground">
            Manage your team and their default hourly rates.
          </p>
        </div>

        <EmployeeList
          initialEmployees={employees ?? []}
          subscriptionStatus={profile?.subscription_status ?? "free"}
        />
      </main>
    </div>
  );
}
