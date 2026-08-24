import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/svg+xml"]);

// One fixed path per user (no extension) so re-uploading always overwrites
// the same object instead of leaving orphaned files behind from earlier
// uploads in a different format.
function logoPathFor(userId: string) {
  return `${userId}/logo`;
}

export async function POST(request: Request) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;

  const formData = await request.formData();
  const file = formData.get("logo");

  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: "No image file provided under the 'logo' field." },
      { status: 400 },
    );
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported image type: ${file.type}` },
      { status: 400 },
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: "Image is too large. Max size is 5MB." },
      { status: 400 },
    );
  }

  const path = logoPathFor(user.id);
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from("logos")
    .upload(path, buffer, { contentType: file.type, upsert: true });

  if (uploadError) {
    return NextResponse.json(
      { error: `Failed to upload logo: ${uploadError.message}` },
      { status: 500 },
    );
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ logo_url: path })
    .eq("id", user.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const { data: signedUrlData } = await supabase.storage
    .from("logos")
    .createSignedUrl(path, 60 * 60);

  return NextResponse.json({ logo_url: path, signed_url: signedUrlData?.signedUrl ?? null });
}

export async function DELETE() {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;

  const path = logoPathFor(user.id);
  await supabase.storage.from("logos").remove([path]);

  const { error } = await supabase
    .from("profiles")
    .update({ logo_url: null })
    .eq("id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
