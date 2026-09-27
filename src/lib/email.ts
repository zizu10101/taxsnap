import { Resend } from "resend";
import { formatDocumentNumber } from "@/lib/document-number";

// No email-sending capability existed anywhere in this codebase before
// this - the only prior SMTP mention was Supabase Auth's own relay for its
// built-in templates (magic link, password reset), which app code can't
// hook custom content into. This is a genuinely new integration: needs
// RESEND_API_KEY set, and the sending domain (gettaxsnap.ca) verified in
// Resend - if that domain already backs Supabase Auth's SMTP, it's likely
// already verified there.
const FROM_ADDRESS = "info@gettaxsnap.ca";

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

// "From" display name is the CONTRACTOR's business name, not just
// "TaxSnap" - so the email reads as coming from the business the client
// actually hired, with TaxSnap named as the platform it went through.
// Falls back to a plain TaxSnap sender when the owner never filled in a
// business name (business_profile_skipped) - "via" with nothing before it
// would read oddly.
function buildFromHeader(businessName: string | null): string {
  return businessName
    ? `${businessName} via TaxSnap <${FROM_ADDRESS}>`
    : `TaxSnap <${FROM_ADDRESS}>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

// Sent right after a client signs an estimate and it's auto-converted to
// an invoice - links to the public, read-only /invoice/[view_token] view
// rather than attaching a PDF (invoice-pdf.ts is a browser-only jsPDF
// build with no server-side equivalent; porting that was scoped out as a
// bigger, separate lift). Returns false (never throws) on any failure -
// signing and the conversion it triggers must succeed regardless of
// whether this email actually goes out; the caller sets
// invoice_email_sent_at only when this returns true, so a failed send is
// still visible/debuggable rather than silently assumed to have worked.
export async function sendInvoiceReadyEmail({
  to,
  businessName,
  clientName,
  documentNumber,
  totalAmount,
  viewUrl,
}: {
  to: string;
  businessName: string | null;
  clientName: string;
  documentNumber: number;
  totalAmount: number;
  viewUrl: string;
}): Promise<boolean> {
  const resend = getResendClient();
  if (!resend) {
    console.error("sendInvoiceReadyEmail: RESEND_API_KEY is not set, skipping send.");
    return false;
  }

  const invoiceLabel = formatDocumentNumber("invoice", documentNumber);
  const fromWho = businessName ?? "your contractor";

  try {
    const { error } = await resend.emails.send({
      from: buildFromHeader(businessName),
      to,
      subject: `Invoice ${invoiceLabel} from ${fromWho}`,
      html: `
        <p>Hi ${escapeHtml(clientName)},</p>
        <p>Thanks for signing off on your estimate. Your invoice ${escapeHtml(invoiceLabel)}
        for <strong>${formatCurrency(totalAmount)}</strong> is ready to view:</p>
        <p><a href="${viewUrl}">${viewUrl}</a></p>
        <p>Sent via TaxSnap on behalf of ${escapeHtml(fromWho)}.</p>
      `,
    });

    if (error) {
      console.error("sendInvoiceReadyEmail: Resend returned an error.", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("sendInvoiceReadyEmail: send threw.", err);
    return false;
  }
}
