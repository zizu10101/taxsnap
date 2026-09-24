import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/dashboard/page-header";
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

  const [{ data: entries }, { data: employees }, { data: jobs }] = await Promise.all([
    supabase
      .from("hour_entries")
      .select("*, employee:employees(*), job:jobs(*)")
      .order("work_date", { ascending: false }),
    supabase.from("employees").select("*").order("name", { ascending: true }),
    supabase.from("jobs").select("*").order("name", { ascending: true }),
  ]);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 lg:max-w-none">
      <PageHeader
        backHref="/dashboard"
        title="Hours"
        subtitle="Log hours worked per employee, per job."
      />

      <HoursList
        initialEntries={(entries ?? []) as HourEntryWithRelations[]}
        initialEmployees={employees ?? []}
        initialJobs={jobs ?? []}
      />
    </div>
  );
}
