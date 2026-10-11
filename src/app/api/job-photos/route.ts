import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { limitReachedMessage, wouldExceedTotalLimit } from "@/lib/plan-limits";
import { PHOTO_BUCKET } from "@/lib/photo-config";
import {
  parseCaption,
  parseJobRef,
  parseTakenAt,
  photoPaths,
  validatePhotoFiles,
  type UploadedFile,
} from "@/lib/job-photos";
import { removePhotoFiles, signPhotos } from "@/lib/job-photos-server";

// Site photos. Available on every tier (the cap is the limit, see PLAN_LIMITS.photos); every query is
// scoped to the signed-in user, and the bucket is private: images are only ever handed out as
// short-lived signed URLs.

// Lists the user's photos for one job (`?job_id=<uuid>`) or the Unsorted pile (`?job_id=unsorted`),
// newest first, with signed URLs and the account's photo usage.
export async function GET(request: Request) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;

  const ref = parseJobRef(new URL(request.url).searchParams.get("job_id") ?? "unsorted");
  if (!ref.ok) return NextResponse.json({ error: ref.error }, { status: 400 });

  let query = supabase
    .from("job_photos")
    .select("id, job_id, caption, taken_at, storage_path, thumb_path")
    .eq("user_id", user.id)
    .order("taken_at", { ascending: false })
    .order("created_at", { ascending: false });
  query = ref.jobId ? query.eq("job_id", ref.jobId) : query.is("job_id", null);

  const [{ data, error }, usage] = await Promise.all([
    query,
    wouldExceedTotalLimit(supabase, user.id, "photos"),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const photos = await signPhotos(supabase.storage, data ?? []);
  return NextResponse.json({
    photos,
    usage: { current: usage.current, limit: usage.limit, exceeded: usage.exceeded },
  });
}

async function readFile(value: FormDataEntryValue | null): Promise<UploadedFile | null> {
  if (!value || typeof value === "string") return null;
  return { type: value.type, size: value.size, bytes: new Uint8Array(await value.arrayBuffer()) };
}

// Adds one photo: `photo` (display JPEG) + `thumb` (thumbnail JPEG) + optional caption / job_id /
// taken_at as multipart form data. One photo per request keeps the body small and lets the form show
// progress. The cap is counted here from the database, never from anything the client sends.
export async function POST(request: Request) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Invalid upload." }, { status: 400 });

  const caption = parseCaption(form.get("caption"));
  if (!caption.ok) return NextResponse.json({ error: caption.error }, { status: 400 });
  const ref = parseJobRef(form.get("job_id"));
  if (!ref.ok) return NextResponse.json({ error: ref.error }, { status: 400 });

  const fileError = validatePhotoFiles(await readFile(form.get("photo")), await readFile(form.get("thumb")));
  if (fileError) return NextResponse.json({ error: fileError }, { status: 400 });
  const photoFile = form.get("photo") as File;
  const thumbFile = form.get("thumb") as File;

  // A foreign key proves the job exists, not that it is this owner's.
  if (ref.jobId) {
    const { data: job } = await supabase
      .from("jobs")
      .select("id")
      .eq("id", ref.jobId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  const cap = await wouldExceedTotalLimit(supabase, user.id, "photos");
  if (cap.exceeded) {
    return NextResponse.json(
      { error: limitReachedMessage(cap, "photo"), code: "FREE_LIMIT_REACHED" },
      { status: 403 },
    );
  }

  const photoId = crypto.randomUUID();
  const paths = photoPaths(user.id, photoId);
  const bucket = supabase.storage.from(PHOTO_BUCKET);

  const upload = await bucket.upload(paths.storage_path, photoFile, { contentType: "image/jpeg", upsert: false });
  if (upload.error) return NextResponse.json({ error: "Couldn't save the photo. Please try again." }, { status: 500 });
  const thumbUpload = await bucket.upload(paths.thumb_path, thumbFile, { contentType: "image/jpeg", upsert: false });
  if (thumbUpload.error) {
    await removePhotoFiles(supabase.storage, [paths]);
    return NextResponse.json({ error: "Couldn't save the photo. Please try again." }, { status: 500 });
  }

  const { data: row, error } = await supabase
    .from("job_photos")
    .insert({
      id: photoId,
      user_id: user.id,
      job_id: ref.jobId,
      ...paths,
      caption: caption.value,
      taken_at: parseTakenAt(form.get("taken_at")),
    })
    .select("id, job_id, caption, taken_at")
    .single();
  if (error || !row) {
    // Never leave files behind for a row that was not written.
    await removePhotoFiles(supabase.storage, [paths]);
    return NextResponse.json({ error: "Couldn't save the photo. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ photo: row }, { status: 201 });
}
