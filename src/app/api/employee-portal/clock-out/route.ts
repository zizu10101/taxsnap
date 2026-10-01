import { NextResponse } from "next/server";
import { requireEmployeeSession } from "@/lib/employee-session";

export async function POST() {
  const result = await requireEmployeeSession();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { session, supabase } = result;

  const { data, error } = await supabase.rpc("employee_clock_out", {
    p_user_id: session.userId,
    p_employee_id: session.employeeId,
  });

  if (error) {
    if (error.message.includes("NOT_CLOCKED_IN")) {
      // Double-tap / second tab: same end state the employee wanted.
      return NextResponse.json({ alreadyClockedOut: true });
    }
    return NextResponse.json({ error: "Couldn't clock you out. Try again." }, { status: 500 });
  }

  return NextResponse.json({ clockedOutAt: data.clock_out_at });
}
