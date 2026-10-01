import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { validateWorkDateForApi } from "@/lib/work-date";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, HourEntryUpdate } from "@/lib/database.types";

// Entries generated from a clock-in/out session derive hours/date/employee/
// job from that session (0043_employee_login.sql) - editing or deleting the
// entry directly would drift from the session's timestamps. Rate edits stay
// allowed.
async function linkedSessionBlock(
  supabase: SupabaseClient<Database>,
  id: string,
) {
  const { data } = await supabase
    .from("hour_entries")
    .select("time_session_id")
    .eq("id", id)
    .maybeSingle();
  if (!data?.time_session_id) return null;
  return NextResponse.json(
    {
      error:
        "This entry came from a clocked session. Edit the session's start/end times on the Employees page instead.",
      code: "LINKED_TO_SESSION",
    },
    { status: 409 },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;
  const { id } = await params;

  const body = await request.json();
  const { employee_id, job_id, work_date, hours, rate, billable_rate } = body ?? {};

  if (
    employee_id !== undefined ||
    job_id !== undefined ||
    work_date !== undefined ||
    hours !== undefined
  ) {
    const blocked = await linkedSessionBlock(supabase, id);
    if (blocked) return blocked;
  }

  const update: HourEntryUpdate = {};

  if (employee_id !== undefined) {
    const { data: employee } = await supabase
      .from("employees")
      .select("id")
      .eq("id", employee_id)
      .eq("user_id", user.id)
      .single();
    if (!employee) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }
    update.employee_id = employee_id;
  }
  if (job_id !== undefined) {
    const { data: job } = await supabase
      .from("jobs")
      .select("id")
      .eq("id", job_id)
      .eq("user_id", user.id)
      .single();
    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    update.job_id = job_id;
  }
  if (work_date !== undefined) {
    const dateError = validateWorkDateForApi(work_date, new Date());
    if (dateError) return NextResponse.json({ error: dateError }, { status: 400 });
    update.work_date = work_date;
  }
  if (hours !== undefined) {
    if (!Number(hours) || Number(hours) <= 0) {
      return NextResponse.json({ error: "hours must be greater than 0." }, { status: 400 });
    }
    update.hours = Number(hours);
  }
  if (rate !== undefined) update.rate = Number(rate);
  if (billable_rate !== undefined) update.billable_rate = Number(billable_rate);

  const { data, error } = await supabase
    .from("hour_entries")
    .update(update)
    .eq("id", id)
    .select("*, employee:employees(*), job:jobs(*)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ hourEntry: data });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { id } = await params;

  const blocked = await linkedSessionBlock(result.supabase, id);
  if (blocked) return blocked;

  const { error } = await result.supabase.from("hour_entries").delete().eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
