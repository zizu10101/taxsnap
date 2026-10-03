import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmployeeList } from "@/components/employees/employee-list";
import { EmployeeLoginLinkCard } from "@/components/employees/employee-login-link-card";

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

  // PIN status (employee_pins exposes only non-secret columns to the owner)
  // and who is clocked in right now, so a forgotten clock-out is visible
  // on this page without opening anything.
  const showLoginLink = profile?.business_type === "general";
  const [{ data: pins }, { data: openRows }, { data: loginSettings }] = await Promise.all([
    supabase.from("employee_pins").select("employee_id"),
    supabase
      .from("time_sessions")
      .select("id, employee_id, clock_in_at, job:jobs(name)")
      .is("clock_out_at", null),
    // The shared sign-in link's token (owner-readable, see 0044).
    showLoginLink
      ? supabase
          .from("app_settings")
          .select("employee_login_token")
          .eq("user_id", user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const openSessions = (openRows ?? []).map((row) => ({
    id: row.id,
    employeeId: row.employee_id,
    clockInAt: row.clock_in_at,
    jobName: (row.job as unknown as { name: string } | null)?.name ?? "a job",
  }));

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 lg:max-w-none">
      <PageHeader
        backHref="/dashboard"
        title="Employees"
        subtitle="Manage your team and their default hourly rates."
      />

      {showLoginLink && (
        <EmployeeLoginLinkCard initialToken={loginSettings?.employee_login_token ?? null} />
      )}

      <EmployeeList
        initialEmployees={employees ?? []}
        pinEmployeeIds={(pins ?? []).map((p) => p.employee_id)}
        openSessions={openSessions}
        subscriptionStatus={profile?.subscription_status ?? "free"}
      />
    </div>
  );
}
