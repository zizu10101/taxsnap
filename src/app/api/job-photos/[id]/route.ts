import { sampleBlockMessage } from "@/lib/sample-data";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { isUuid, parseCaption, parseJobRef } from "@/lib/job-photos";
import type { JobPhotoUpdate } from "@/lib/database.types";

// (Deleting photos - one or many - is POST /api/job-photos/bulk.)
//
// Moves a photo to another job (or back to Unsorted) and/or edits its caption. Body: `{ job_id?, caption? }`
// - `job_id: null` (or "unsorted") files it under Unsorted. Scoped to the signed-in user, and the target
// job must be theirs.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Photo not found." }, { status: 404 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const update: JobPhotoUpdate = {};
  if ("caption" in body) {
    const caption = parseCaption(body.caption);
    if (!caption.ok) return NextResponse.json({ error: caption.error }, { status: 400 });
    update.caption = caption.value;
  }
  if ("job_id" in body) {
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
      const sampleMessage = await sampleBlockMessage(supabase, user.id, { jobId: ref.jobId });
      if (sampleMessage) return NextResponse.json({ error: sampleMessage }, { status: 400 });
    }
    update.job_id = ref.jobId;
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("job_photos")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, job_id, caption, taken_at")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Photo not found." }, { status: 404 });
  return NextResponse.json({ photo: data });
}
