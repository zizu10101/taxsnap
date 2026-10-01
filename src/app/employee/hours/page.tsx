import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  EMPLOYEE_COOKIE,
  EMPLOYEE_LINK_COOKIE,
  createServiceClient,
  lookupEmployeeSession,
} from "@/lib/employee-session";
import { EmployeeHoursView } from "@/components/employee-portal/employee-hours-view";

export const metadata: Metadata = {
  title: "Clock in — TaxSnap",
  robots: { index: false, follow: false },
};

// Always fresh: this is a live clock, never a cached render.
export const dynamic = "force-dynamic";

export default async function EmployeeHoursPage() {
  const cookieStore = await cookies();
  const raw = cookieStore.get(EMPLOYEE_COOKIE)?.value;
  const session = raw ? await lookupEmployeeSession(raw) : null;

  if (!session) {
    // Session ended or never existed: send them back to their business's
    // sign-in page if we remember it, otherwise tell them what to do.
    const linkToken = cookieStore.get(EMPLOYEE_LINK_COOKIE)?.value;
    if (linkToken) redirect(`/employee-login/${linkToken}`);
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 text-center">
        <h1 className="text-xl font-bold">Signed out</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Open the sign-in link your employer shared with you to clock in.
        </p>
      </main>
    );
  }

  const supabase = createServiceClient();

  // Only this employee's rows, and only the columns the employee view shows:
  // no rates or costs ever leave the server for this session.
  const [{ data: openSession }, { data: history }, { data: jobs }, { data: profile }] =
    await Promise.all([
      supabase
        .from("time_sessions")
        .select("id, clock_in_at, job:jobs(name)")
        .eq("employee_id", session.employeeId)
        .is("clock_out_at", null)
        .maybeSingle(),
      supabase
        .from("time_sessions")
        .select("id, clock_in_at, clock_out_at, job:jobs(name)")
        .eq("employee_id", session.employeeId)
        .not("clock_out_at", "is", null)
        .order("clock_in_at", { ascending: false })
        .limit(50),
      supabase
        .from("jobs")
        .select("id, name")
        .eq("user_id", session.userId)
        .order("name", { ascending: true }),
      supabase.from("profiles").select("business_name").eq("id", session.userId).single(),
    ]);

  const jobName = (row: { job: unknown } | null) =>
    (row?.job as { name: string } | null)?.name ?? "Job";

  return (
    <EmployeeHoursView
      employeeName={session.employeeName}
      businessName={profile?.business_name ?? null}
      jobs={jobs ?? []}
      openSession={
        openSession
          ? {
              clockInAt: openSession.clock_in_at,
              jobName: jobName(openSession),
            }
          : null
      }
      history={(history ?? []).map((h) => ({
        id: h.id,
        clockInAt: h.clock_in_at,
        clockOutAt: h.clock_out_at as string,
        jobName: jobName(h),
      }))}
    />
  );
}
