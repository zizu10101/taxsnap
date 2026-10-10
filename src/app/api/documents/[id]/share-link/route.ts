import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import {
  ensureSignToken,
  ensureViewToken,
  EstimateNotFoundError,
  InvoiceNotFoundError,
} from "@/lib/document-sign-link";

function getAppUrl(request: Request) {
  return process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
}

// The Send menu's "Copy link": the public page the client opens - /sign/[token] for an estimate (they
// can review and sign), /invoice/[token] for an invoice (read-only). The token is created the first time
// it is asked for and reused after, so re-sharing never breaks a link the client already opened. This
// only ever writes the token column - never the document's status.
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

  const { data: doc } = await supabase
    .from("documents")
    .select("id, type")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!doc) return NextResponse.json({ error: "Document not found." }, { status: 404 });

  try {
    if (doc.type === "estimate") {
      const token = await ensureSignToken(supabase, id, user.id);
      return NextResponse.json({ url: `${getAppUrl(request)}/sign/${token}` });
    }
    const token = await ensureViewToken(supabase, id, user.id);
    return NextResponse.json({ url: `${getAppUrl(request)}/invoice/${token}` });
  } catch (err) {
    if (err instanceof EstimateNotFoundError || err instanceof InvoiceNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : "Failed to create the link";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
