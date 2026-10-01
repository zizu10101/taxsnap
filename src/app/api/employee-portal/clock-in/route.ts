import { NextResponse } from "next/server";
import { requireEmployeeSession } from "@/lib/employee-session";

export async function POST(request: Request) {
  const result = await requireEmployeeSession();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { session, supabase } = result;

  const body = await request.json().catch(() => ({}));
  const jobId = typeof body?.job_id === "string" ? body.job_id : "";
  if (!jobId) {
    return NextResponse.json({ error: "Pick a job to clock in to." }, { status: 400 });
  }

  // employee_id/user_id come from the verified session row, never the body.
  const { data, error } = await supabase.rpc("employee_clock_in", {
    p_user_id: session.userId,
    p_employee_id: session.employeeId,
    p_job_id: jobId,
  });

  if (error) {
    if (error.message.includes("ALREADY_CLOCKED_IN")) {
      // Never silently closes or stacks a second session: the employee is
      // told exactly what's open. A forgotten clock-out from a prior day is
      // the owner's to fix (they get a flag on the Employees page).
      const { data: open } = await supabase
        .from("time_sessions")
        .select("clock_in_at, job:jobs(name)")
        .eq("employee_id", session.employeeId)
        .is("clock_out_at", null)
        .maybeSingle();
      const jobName = (open?.job as unknown as { name: string } | null)?.name;
      return NextResponse.json(
        {
          error: open
            ? `You're already clocked in${jobName ? ` on ${jobName}` : ""}. Clock out first, or ask your employer to close it if it's an old one.`
            : "You're already clocked in.",
          code: "ALREADY_CLOCKED_IN",
        },
        { status: 409 },
      );
    }
    if (error.message.includes("JOB_NOT_FOUND")) {
      return NextResponse.json({ error: "That job isn't available." }, { status: 404 });
    }
    if (error.message.includes("EMPLOYEE_NOT_FOUND")) {
      return NextResponse.json({ error: "Your account is no longer active." }, { status: 403 });
    }
    return NextResponse.json({ error: "Couldn't clock you in. Try again." }, { status: 500 });
  }

  return NextResponse.json({ clockedInAt: data.clock_in_at }, { status: 201 });
}
