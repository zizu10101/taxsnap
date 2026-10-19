import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { wouldExceedTotalLimit, limitReachedMessage } from "@/lib/plan-limits";
import { findJobByName, isUniqueViolation } from "@/lib/find-by-name";
import { parsePlaceText } from "@/lib/job-fields";

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
// The job cap below is also enforced, through lib/job-cap.ts, on every other
// route that can create a job from a typed name (documents, hours, receipts) -
// the DB trigger (sync_receipt_job in 0009_jobs.sql) can't know about plan
// caps, so the receipts routes check before it runs.
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

  const location = parsePlaceText(body?.location, "Location");
  if (!location.ok) return NextResponse.json({ error: location.error }, { status: 400 });

  // Find-or-create: an existing job is returned as is - a location typed on the create form
  // never overwrites the one already on file (that is what Edit job is for).
  const existing = await findJobByName(supabase, user.id, name);

  if (existing) {
    return NextResponse.json({ job: existing });
  }

  const clientId: unknown = body?.client_id ?? null;
  if (clientId !== null) {
    const { data: client } =
      typeof clientId === "string"
        ? await supabase
            .from("clients")
            .select("id")
            .eq("id", clientId)
            .eq("user_id", user.id)
            .maybeSingle()
        : { data: null };
    if (!client) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
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
    .insert({
      user_id: user.id,
      name,
      location: location.value ?? null,
      client_id: (clientId as string | null) ?? null,
    })
    .select()
    .single();

  if (isUniqueViolation(error)) {
    // Lost a race with a concurrent create of the same name - return the winner.
    const winner = await findJobByName(supabase, user.id, name);
    if (winner) return NextResponse.json({ job: winner });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ job: data }, { status: 201 });
}
