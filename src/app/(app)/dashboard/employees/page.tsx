import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/dashboard/page-header";
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
    <div className="mx-auto w-full max-w-2xl space-y-6 lg:max-w-none">
      <PageHeader
        backHref="/dashboard"
        title="Employees"
        subtitle="Manage your team and their default hourly rates."
      />

      <EmployeeList
        initialEmployees={employees ?? []}
        subscriptionStatus={profile?.subscription_status ?? "free"}
      />
    </div>
  );
}
