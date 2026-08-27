import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";

export async function GET(request: Request) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase } = result;

  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("job_id");
  const employeeId = searchParams.get("employee_id");

  let query = supabase
    .from("hour_entries")
    .select("*, employee:employees(*), job:jobs(*)")
    .order("work_date", { ascending: false });

  if (jobId) query = query.eq("job_id", jobId);
  if (employeeId) query = query.eq("employee_id", employeeId);

  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ hourEntries: data });
}

export async function POST(request: Request) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;

  const body = await request.json();
  const {
    employee_id,
    job_id: jobIdInput,
    job_name,
    work_date,
    hours,
    rate: rateInput,
  } = body ?? {};

  if (!employee_id) {
    return NextResponse.json({ error: "employee_id is required." }, { status: 400 });
  }
  if (!Number(hours) || Number(hours) <= 0) {
    return NextResponse.json({ error: "hours must be greater than 0." }, { status: 400 });
  }

  // Ownership of employee_id/job_id is checked explicitly rather than
  // relying on the foreign key alone - FK constraints check row existence
  // across the whole table, not per-user, so without this a user could
  // reference another account's employee/job by id.
  const { data: employee, error: employeeError } = await supabase
    .from("employees")
    .select("*")
    .eq("id", employee_id)
    .eq("user_id", user.id)
    .single();

  if (employeeError || !employee) {
    return NextResponse.json({ error: "Employee not found." }, { status: 404 });
  }

  let jobId: string | undefined = jobIdInput ?? undefined;
  if (!jobId && job_name?.trim()) {
    const name = job_name.trim();
    const { data: existingJob } = await supabase
      .from("jobs")
      .select("*")
      .eq("user_id", user.id)
      .eq("name", name)
      .maybeSingle();

    if (existingJob) {
      jobId = existingJob.id;
    } else {
      const { data: newJob, error: newJobError } = await supabase
        .from("jobs")
        .insert({ user_id: user.id, name })
        .select()
        .single();
      if (newJobError) {
        return NextResponse.json({ error: newJobError.message }, { status: 500 });
      }
      jobId = newJob.id;
    }
  }

  if (!jobId) {
    return NextResponse.json({ error: "job_id or job_name is required." }, { status: 400 });
  }

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id")
    .eq("id", jobId)
    .eq("user_id", user.id)
    .single();

  if (jobError || !job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  // Auto-filled from the employee's default rate, but editable per entry
  // (covers commission workers, raises, job-specific rates).
  const rate = rateInput !== undefined && rateInput !== null
    ? Number(rateInput)
    : employee.default_hourly_rate;

  const { data, error } = await supabase
    .from("hour_entries")
    .insert({
      user_id: user.id,
      employee_id,
      job_id: jobId,
      work_date: work_date || undefined,
      hours: Number(hours),
      rate,
    })
    .select("*, employee:employees(*), job:jobs(*)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ hourEntry: data }, { status: 201 });
}
