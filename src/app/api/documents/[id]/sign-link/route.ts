import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { ensureSignToken, EstimateNotFoundError } from "@/lib/document-sign-link";

function getAppUrl(request: Request) {
  return process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
}

// "Copy Link" action - lazily creates sign_token the first time the owner
// asks for a signature link (not eagerly at estimate creation) and hands
// back the URL to copy. Idempotent: calling this again on an estimate
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

  try {
    const token = await ensureSignToken(supabase, id, user.id);
    return NextResponse.json({ url: `${getAppUrl(request)}/sign/${token}` });
  } catch (err) {
    if (err instanceof EstimateNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : "Failed to create signature link";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
