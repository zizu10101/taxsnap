import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { wouldExceedTotalLimit, limitReachedMessage } from "@/lib/plan-limits";

export async function GET() {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const { data, error } = await result.supabase
    .from("jobs")
    .select("*")
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ jobs: data });
}

// Find-or-create by name, mirroring the "type a new client name inline"
// pattern in /api/documents - lets the hour entry form create a job on the
// fly without duplicating a job that already exists (e.g. one auto-created
// from a receipt's job_name via the DB trigger in 0009_jobs.sql).
//
// The job cap below is only enforced on this explicit create path - it
// deliberately does NOT reach the DB trigger (sync_receipt_job in
// 0009_jobs.sql) that auto-creates a job row when a receipt's job_name is
// set to a new name. Blocking that path would mean failing a receipt save
// over a job cap, which is a worse trade than letting a free account's
// job count grow past 1 via that specific route.
export async function POST(request: Request) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;

  const body = await request.json();
  const name: string | undefined = body?.name?.trim();

  if (!name) {
    return NextResponse.json({ error: "Job name is required." }, { status: 400 });
  }

  const { data: existing } = await supabase
    .from("jobs")
    .select("*")
    .eq("user_id", user.id)
    .eq("name", name)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ job: existing });
  }

  const totalCheck = await wouldExceedTotalLimit(supabase, user.id, "jobs");
  if (totalCheck.exceeded) {
    return NextResponse.json(
      { error: limitReachedMessage(totalCheck, "job"), code: "FREE_LIMIT_REACHED" },
      { status: 403 },
    );
  }

  const { data, error } = await supabase
    .from("jobs")
    .insert({ user_id: user.id, name })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ job: data }, { status: 201 });
}
