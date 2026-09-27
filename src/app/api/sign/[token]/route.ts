import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { sendInvoiceReadyEmail } from "@/lib/email";
import {
  convertEstimateToInvoice,
  EstimateAlreadyConvertedError,
} from "@/lib/estimate-conversion";

function getAppUrl(request: Request) {
  return process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
}

// Best-effort only - x-forwarded-for can be absent or spoofed depending on
// what's in front of this app, same "reference/reporting only" trust
// level as every other non-critical metadata column in this codebase
// (commission_entries.payment_method, etc.). Never used for anything but
// display on the owner's own dashboard.
function getClientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded ? forwarded.split(",")[0].trim() : null;
}

// Public, unauthenticated route - no session exists for an anonymous
// signer, so this uses the service-role admin client (bypasses RLS) and
// resolves the estimate *only* by the opaque sign_token in the URL, never
// a document id from the request body. This is the entire authorization
// boundary for this route: knowing the token is knowing the estimate.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const supabase = createAdminClient();

  const { data: estimate } = await supabase
    .from("documents")
    .select("id, user_id, signed_at, document_number")
    .eq("sign_token", token)
    .eq("type", "estimate")
    .maybeSingle();

  if (!estimate) {
    return NextResponse.json({ error: "Sign link not found." }, { status: 404 });
  }

  if (estimate.signed_at) {
    // Already signed (page reload, double-submit, a second tab) - not an
    // error, the page's own job is to show the same confirmation state
    // either way.
    return NextResponse.json({ already_signed: true, signed_at: estimate.signed_at });
  }

  const body = await request.json().catch(() => ({}));
  const signerName = typeof body?.signer_name === "string" ? body.signer_name.trim() : "";
  const agreed = body?.agreed === true;

  if (!signerName) {
    return NextResponse.json({ error: "Enter your full name." }, { status: 400 });
  }
  if (!agreed) {
    return NextResponse.json(
      { error: "You must agree to this estimate before signing." },
      { status: 400 },
    );
  }

  // Conditional update, not a plain UPDATE - `is("signed_at", null)` means
  // a concurrent duplicate submit (double-tap) only ever lets one request
  // through; the loser gets zero rows back and is treated as the same
  // "already signed" state above, rather than racing into two
  // conversions/two invoices for the same estimate.
  const nowIso = new Date().toISOString();
  const { data: signedRows, error: signError } = await supabase
    .from("documents")
    .update({
      signed_at: nowIso,
      signer_name: signerName,
      signer_ip: getClientIp(request),
    })
    .eq("id", estimate.id)
    .is("signed_at", null)
    .select("id");

  if (signError) {
    return NextResponse.json({ error: signError.message }, { status: 500 });
  }
  if (!signedRows || signedRows.length === 0) {
    return NextResponse.json({ already_signed: true, signed_at: nowIso });
  }

  let invoiceNumber = estimate.document_number;
  try {
    const invoice = await convertEstimateToInvoice(supabase, estimate.id, estimate.user_id, {
      generateViewToken: true,
      bypassMonthlyLimit: true,
    });
    invoiceNumber = invoice.document_number;

    const client = invoice.client as { name: string; email: string | null } | null;
    if (client?.email && invoice.view_token) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("business_name")
        .eq("id", estimate.user_id)
        .single();

      const sent = await sendInvoiceReadyEmail({
        to: client.email,
        businessName: profile?.business_name ?? null,
        clientName: client.name,
        documentNumber: invoice.document_number,
        totalAmount: invoice.total_amount,
        viewUrl: `${getAppUrl(request)}/invoice/${invoice.view_token}`,
      });

      if (sent) {
        await supabase
          .from("documents")
          .update({ invoice_email_sent_at: new Date().toISOString() })
          .eq("id", invoice.id);
      }
    }
  } catch (err) {
    // The signature itself is already recorded and committed above - a
    // conversion failure (including a rare race where the owner manually
    // converted the same estimate moments earlier, see
    // EstimateAlreadyConvertedError) must never make the signer see an
    // error for something that, from their side, already succeeded.
    if (!(err instanceof EstimateAlreadyConvertedError)) {
      console.error("POST /api/sign/[token]: conversion failed after signing.", err);
    }
  }

  return NextResponse.json({ success: true, signed_at: nowIso, invoice_number: invoiceNumber });
}
