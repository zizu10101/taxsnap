import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";

export async function GET() {
  const result = await requireProUser();
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
export async function POST(request: Request) {
  const result = await requireProUser();
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

  const { data, error } = await supabase
    .from("jobs")
    .insert({ user_id: user.id, name })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ job: data }, { status: 201 });
}
