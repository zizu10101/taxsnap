import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseReceiptImage } from "@/lib/gemini";
import { FREE_SCAN_LIMIT } from "@/lib/pricing-plans";
import { getPresetRange, rangeToUtcBounds } from "@/lib/date-range";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

// Maps a failed Gemini call to a user-safe message + HTTP status, keyed off
// the real upstream HTTP status the SDK's ApiError carries - never a
// default. "Busy" is only ever shown for a genuine 503/UNAVAILABLE from
// Google; anything else (auth/config problem, a response we couldn't
// parse, a network failure) gets its own accurate message instead of being
// mislabeled as a capacity issue. The raw upstream error is always logged
// server-side (see the catch block), never sent to the client.
function describeParseFailure(err: unknown): { message: string; status: number } {
  const upstream = (err as { status?: unknown } | null)?.status;
  if (upstream === 503) {
    return {
      message: "Receipt scanning is busy right now. Please try again in a minute.",
      status: 503,
    };
  }
  if (upstream === 429) {
    return {
      message: "Receipt scanning is temporarily rate limited. Please try again shortly.",
      status: 429,
    };
  }
  if (upstream === 400 || upstream === 401 || upstream === 403 || upstream === 404) {
    // Bad/revoked key, retired model, or a request Google rejected - not
    // something the user can fix, so don't blame their file or the load.
    return {
      message: "Receipt scanning is unavailable right now. We're looking into it.",
      status: 502,
    };
  }
  if (err instanceof SyntaxError || (err instanceof Error && err.message.includes("empty response"))) {
    return {
      message: "We couldn't read this receipt. Try a clearer photo or a different file.",
      status: 502,
    };
  }
  return {
    message: "Something went wrong scanning this receipt. Please try again.",
    status: 502,
  };
}

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
    // Resets monthly, not a lifetime cap - "5 free receipt scans" is
    // advertised per month (see pricing-plans.ts), so only count scans
    // created since the start of the current calendar month. Uses the
    // server's own local time as the month boundary (same SSR-default
    // rationale as date-range.ts's own comment) - precision to the shop's
    // exact local midnight doesn't matter for a monthly usage reset.
    const { from } = rangeToUtcBounds(getPresetRange("this-month"));
    const { count } = await supabase
      .from("receipts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", from!);

    if ((count ?? 0) >= FREE_SCAN_LIMIT) {
      return NextResponse.json(
        {
          error: `You've used all ${FREE_SCAN_LIMIT} free receipt scans this month. Upgrade to Plus for unlimited scans.`,
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
      { error: `Unsupported file type: ${file.type}` },
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
    // Log the real failure - the response below is deliberately user-safe and
    // drops the upstream detail, so without this the logs would show no cause.
    // Deliberately no receipt contents or user id: just the file's type/size
    // and the underlying error, enough to tell a PDF-only failure from an
    // all-uploads one and to spot a bad/revoked API key.
    console.error("[parse-receipt] Gemini parse failed", {
      mimeType: file.type,
      sizeBytes: file.size,
      error: err instanceof Error ? err.message : String(err),
      status: (err as { status?: number } | null)?.status,
    });

    // Clean up the uploaded image if parsing failed, so we don't leave
    // orphaned files around for a receipt that was never saved.
    await supabase.storage.from("receipts").remove([storagePath]);

    const { message, status } = describeParseFailure(err);
    return NextResponse.json({ error: message }, { status });
  }
}
