import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { ensureSignToken, EstimateNotFoundError } from "@/lib/document-sign-link";
import { sendSignatureRequestEmail } from "@/lib/email";

function getAppUrl(request: Request) {
  return process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
}

// "Email Signature Link to Client" - a faster alternative to "Copy Link"
// for when email is actually the right channel (many of this app's own
// users lean on WhatsApp instead, which is exactly why Copy Link stays
// available rather than being replaced by this). Reuses the same
// ensureSignToken lazy-creation logic as Copy Link, and the same Resend
// infrastructure the invoice auto-send already uses.
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
    .select("id, document_number, total_amount, client:clients(name, email)")
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("type", "estimate")
    .single();

  if (fetchError || !estimate) {
    return NextResponse.json({ error: "Estimate not found." }, { status: 404 });
  }

  const client = estimate.client as { name: string; email: string | null } | null;
  if (!client?.email) {
    return NextResponse.json(
      { error: "This client has no email on file - use Copy Link instead." },
      { status: 400 },
    );
  }

  let token: string;
  try {
    token = await ensureSignToken(supabase, id, user.id);
  } catch (err) {
    if (err instanceof EstimateNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : "Failed to create signature link";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("business_name")
    .eq("id", user.id)
    .single();

  const sent = await sendSignatureRequestEmail({
    to: client.email,
    businessName: profile?.business_name ?? null,
    clientName: client.name,
    documentNumber: estimate.document_number,
    totalAmount: estimate.total_amount,
    signUrl: `${getAppUrl(request)}/sign/${token}`,
  });

  if (!sent) {
    return NextResponse.json(
      { error: "Failed to send the email - try Copy Link instead." },
      { status: 502 },
    );
  }

  return NextResponse.json({ success: true, sent_to: client.email });
}
