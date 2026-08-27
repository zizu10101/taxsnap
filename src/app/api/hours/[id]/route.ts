import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";
import type { HourEntryUpdate } from "@/lib/database.types";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;
  const { id } = await params;

  const body = await request.json();
  const { employee_id, job_id, work_date, hours, rate } = body ?? {};

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
  if (work_date !== undefined) update.work_date = work_date;
  if (hours !== undefined) {
    if (!Number(hours) || Number(hours) <= 0) {
      return NextResponse.json({ error: "hours must be greater than 0." }, { status: 400 });
    }
    update.hours = Number(hours);
  }
  if (rate !== undefined) update.rate = Number(rate);

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
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { id } = await params;

  const { error } = await result.supabase.from("hour_entries").delete().eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
