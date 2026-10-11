import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { parseIdList, parseJobRef } from "@/lib/job-photos";
import { deletePhotos, movePhotos } from "@/lib/job-photos-server";

// Several photos at once. Body: `{ action: "delete", ids }` or `{ action: "move", ids, job_id }`
// (`job_id: null` = Unsorted). Every id is checked against the signed-in user; the target job must be
// theirs. Delete removes each photo's row and BOTH files, one photo at a time, and the response says
// exactly what happened to every id - nothing is swallowed.
export async function POST(request: Request) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const list = parseIdList(body.ids);
  if (!list.ok) return NextResponse.json({ error: list.error }, { status: 400 });

  if (body.action === "delete") {
    const outcome = await deletePhotos(supabase, supabase.storage, user.id, list.ids);
    return NextResponse.json(outcome);
  }

  if (body.action === "move") {
    const ref = parseJobRef(body.job_id);
    if (!ref.ok) return NextResponse.json({ error: ref.error }, { status: 400 });
    if (ref.jobId) {
      const { data: job } = await supabase
        .from("jobs")
        .select("id")
        .eq("id", ref.jobId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    try {
      return NextResponse.json(await movePhotos(supabase, user.id, list.ids, ref.jobId));
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't move the photos." }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
