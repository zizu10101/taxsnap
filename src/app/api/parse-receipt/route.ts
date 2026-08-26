import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseReceiptImage } from "@/lib/gemini";
import { FREE_SCAN_LIMIT } from "@/lib/pricing-plans";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_status")
    .eq("id", user.id)
    .single();

  if (!profile || profile.subscription_status === "free") {
    const { count } = await supabase
      .from("receipts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);

    if ((count ?? 0) >= FREE_SCAN_LIMIT) {
      return NextResponse.json(
        {
          error: `You've used all ${FREE_SCAN_LIMIT} free receipt scans. Upgrade to Basic for unlimited scans.`,
          code: "FREE_LIMIT_REACHED",
        },
        { status: 403 },
      );
    }
  }

  const formData = await request.formData();
  const file = formData.get("image");

  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: "No image file provided under the 'image' field." },
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
      { error: "Image is too large. Max size is 10MB." },
      { status: 400 },
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Upload the original image to private storage, namespaced by user id so
  // the storage RLS policies (see supabase/migrations/0001_init.sql) apply.
  const extension = file.name.split(".").pop() || "jpg";
  const storagePath = `${user.id}/${crypto.randomUUID()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from("receipts")
    .upload(storagePath, buffer, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json(
      { error: `Failed to upload image: ${uploadError.message}` },
      { status: 500 },
    );
  }

  try {
    const parsed = await parseReceiptImage(buffer.toString("base64"), file.type);

    const { data: signedUrlData } = await supabase.storage
      .from("receipts")
      .createSignedUrl(storagePath, 60 * 60 * 24 * 7); // 7 days

    return NextResponse.json({
      parsed,
      image_path: storagePath,
      image_url: signedUrlData?.signedUrl ?? null,
    });
  } catch (err) {
    // Clean up the uploaded image if parsing failed, so we don't leave
    // orphaned files around for a receipt that was never saved.
    await supabase.storage.from("receipts").remove([storagePath]);

    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to parse receipt: ${message}` },
      { status: 502 },
    );
  }
}
