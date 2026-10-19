import { Resend } from "resend";
import { formatDocumentNumber } from "@/lib/document-number";
import { INVOICE_FOOTER_TEXT, INVOICE_FOOTER_URL } from "@/lib/invoice-footer";

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

// The Free-plan credit under an emailed invoice (see lib/invoice-footer.ts).
function brandFooterHtml(show: boolean): string {
  return show
    ? `<p style="font-size:12px;color:#888"><a href="${INVOICE_FOOTER_URL}" style="color:#888">${INVOICE_FOOTER_TEXT}</a></p>`
    : "";
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
  brandFooter = false,
}: {
  to: string;
  businessName: string | null;
  clientName: string;
  documentNumber: number;
  totalAmount: number;
  viewUrl: string;
  /** Free-plan invoice: append the "Created with TaxSnap" credit. */
  brandFooter?: boolean;
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
        ${brandFooterHtml(brandFooter)}
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

// The owner's "Email to client" action in the Send menu. The PDF is built in the browser (invoice-pdf.ts
// is a browser-only jsPDF build) and posted to the route, which hands the bytes here to attach. For an
// estimate that still needs a signature, `signUrl` adds the signing link to the body. Sending an email
// never changes the document's status - the caller must not either. Same never-throws/returns-false
// contract as above: the caller surfaces a failure as an error toast.
export async function sendDocumentEmail({
  to,
  businessName,
  replyTo,
  clientName,
  type,
  documentNumber,
  totalAmount,
  signUrl,
  pdf,
  filename,
  brandFooter = false,
}: {
  to: string;
  businessName: string | null;
  replyTo: string | null;
  clientName: string;
  type: "invoice" | "estimate";
  documentNumber: number;
  totalAmount: number;
  signUrl: string | null;
  pdf: Buffer;
  filename: string;
  /** Free-plan invoice: append the "Created with TaxSnap" credit. */
  brandFooter?: boolean;
}): Promise<boolean> {
  const resend = getResendClient();
  if (!resend) {
    console.error("sendDocumentEmail: RESEND_API_KEY is not set, skipping send.");
    return false;
  }

  const label = formatDocumentNumber(type, documentNumber);
  const noun = type === "invoice" ? "invoice" : "estimate";
  const fromWho = businessName ?? "your contractor";

  try {
    const { error } = await resend.emails.send({
      from: buildFromHeader(businessName),
      to,
      ...(replyTo ? { replyTo } : {}),
      subject: `${noun[0].toUpperCase()}${noun.slice(1)} ${label} from ${fromWho}`,
      html: `
        <p>Hi ${escapeHtml(clientName)},</p>
        <p>${escapeHtml(fromWho)} sent you ${noun} ${escapeHtml(label)} for
        <strong>${formatCurrency(totalAmount)}</strong>. It is attached as a PDF.</p>
        ${
          signUrl
            ? `<p>You can review and sign it online here:</p><p><a href="${signUrl}">${signUrl}</a></p>`
            : ""
        }
        <p>Sent via TaxSnap on behalf of ${escapeHtml(fromWho)}.</p>
        ${brandFooterHtml(brandFooter)}
      `,
      attachments: [{ filename, content: pdf }],
    });

    if (error) {
      console.error("sendDocumentEmail: Resend returned an error.", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("sendDocumentEmail: send threw.", err);
    return false;
  }
}

// Sent by the Connect webhook right after an online invoice payment is recorded.
// Only what the client already knows: who they paid, which invoice, how much, what
// is left, and the link to the invoice page. No notes, no line items, nothing from
// Stripe's objects. Same never-throws/returns-false contract as the senders above -
// the payment is already recorded whether or not this goes out.
export async function sendPaymentReceiptEmail({
  to,
  businessName,
  clientName,
  documentNumber,
  amountPaid,
  balanceRemaining,
  viewToken,
  brandFooter,
  appUrl,
}: {
  to: string;
  businessName: string | null;
  clientName: string;
  documentNumber: number;
  amountPaid: number;
  balanceRemaining: number;
  viewToken: string | null;
  brandFooter: boolean;
  appUrl: string;
}): Promise<boolean> {
  const resend = getResendClient();
  if (!resend) {
    console.error("sendPaymentReceiptEmail: RESEND_API_KEY is not set, skipping send.");
    return false;
  }

  const label = formatDocumentNumber("invoice", documentNumber);
  const fromWho = businessName ?? "your contractor";
  const viewUrl = viewToken ? `${appUrl}/invoice/${viewToken}` : null;
  const status =
    balanceRemaining > 0
      ? `The remaining balance is <strong>${formatCurrency(balanceRemaining)}</strong>.`
      : "This invoice is now paid in full.";

  try {
    const { error } = await resend.emails.send({
      from: buildFromHeader(businessName),
      to,
      subject: `Receipt for invoice ${label} from ${fromWho}`,
      html: `
        <p>Hi ${escapeHtml(clientName)},</p>
        <p>We received your payment of <strong>${formatCurrency(amountPaid)}</strong> to ${escapeHtml(fromWho)}
        for invoice ${escapeHtml(label)}. ${status}</p>
        ${viewUrl ? `<p>You can view the invoice here: <a href="${viewUrl}">${viewUrl}</a></p>` : ""}
        <p>Sent via TaxSnap on behalf of ${escapeHtml(fromWho)}.</p>
        ${brandFooterHtml(brandFooter)}
      `,
    });
    if (error) {
      console.error("sendPaymentReceiptEmail: Resend returned an error.", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("sendPaymentReceiptEmail: send threw.", err);
    return false;
  }
}
