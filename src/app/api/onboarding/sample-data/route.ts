import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { SAMPLE_CLIENT_NAME, SAMPLE_JOB_NAME } from "@/lib/onboarding";

// "Try with sample data": ONE clearly labelled demo client and ONE demo job
// (is_sample = true). They never count toward plan caps, never appear in reports,
// and POST /api/documents, /api/receipts and /api/hours refuse them
// (lib/sample-data.ts), so nothing built from real records can include them.
// Idempotent: asking twice returns the existing pair.
export async function POST() {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;

  const [{ data: existingClient }, { data: existingJob }] = await Promise.all([
    supabase.from("clients").select("id").eq("user_id", user.id).eq("is_sample", true).maybeSingle(),
    supabase.from("jobs").select("id").eq("user_id", user.id).eq("is_sample", true).maybeSingle(),
  ]);

  let clientId = existingClient?.id ?? null;
  if (!clientId) {
    const { data, error } = await supabase
      .from("clients")
      .insert({ user_id: user.id, name: SAMPLE_CLIENT_NAME, is_sample: true })
      .select("id")
      .single();
    if (error) {
      return NextResponse.json(
        { error: "Could not add the sample client - a client with that name may already exist." },
        { status: 409 },
      );
    }
    clientId = data.id;
  }

  if (!existingJob) {
    const { error } = await supabase
      .from("jobs")
      .insert({ user_id: user.id, name: SAMPLE_JOB_NAME, client_id: clientId, is_sample: true });
    if (error) {
      return NextResponse.json(
        { error: "Could not add the sample job - a job with that name may already exist." },
        { status: 409 },
      );
    }
  }

  return NextResponse.json({ success: true }, { status: 201 });
}

// "Remove sample data": deletes only rows flagged is_sample, job first (it
// references the client).
export async function DELETE() {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;

  const { error: jobError } = await supabase
    .from("jobs")
    .delete()
    .eq("user_id", user.id)
    .eq("is_sample", true);
  if (jobError) return NextResponse.json({ error: jobError.message }, { status: 500 });

  const { error: clientError } = await supabase
    .from("clients")
    .delete()
    .eq("user_id", user.id)
    .eq("is_sample", true);
  if (clientError) return NextResponse.json({ error: clientError.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
