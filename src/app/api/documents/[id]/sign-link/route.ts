import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { generateOpaqueToken } from "@/lib/opaque-token";

function getAppUrl(request: Request) {
  return process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
}

// Lazily creates sign_token the first time the owner asks for a
// signature link (not eagerly at estimate creation) - a still-drafting
// estimate the owner never intends to send for signature shouldn't carry
// a live, shareable token. Idempotent: calling this again on an estimate
// that already has one just returns the existing link unchanged, so
// re-sharing never invalidates a link the client may have already opened.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;
  const { id } = await params;

  const { data: estimate, error: fetchError } = await supabase
    .from("documents")
    .select("id, sign_token, signed_at, type")
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("type", "estimate")
    .single();

  if (fetchError || !estimate) {
    return NextResponse.json({ error: "Estimate not found." }, { status: 404 });
  }

  let token = estimate.sign_token;
  if (!token) {
    token = generateOpaqueToken();
    const { error: updateError } = await supabase
      .from("documents")
      .update({ sign_token: token })
      .eq("id", id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ url: `${getAppUrl(request)}/sign/${token}` });
}
