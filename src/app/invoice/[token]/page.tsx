import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { PublicDocumentPaper } from "@/components/public/document-paper";
import { showsInvoiceFooter } from "@/lib/invoice-footer";
import { PayNowButton } from "@/components/public/pay-now-button";
import { onlinePayableAmount } from "@/lib/connect-status";
import { PaymentConfirmation } from "@/components/public/payment-confirmation";
import { showPayNow } from "@/lib/online-payment-watch";

export const metadata: Metadata = {
  title: "Invoice — TaxSnap",
};

// Public, unauthenticated, read-only page - the link the client's
// "invoice is ready" email points at (see lib/email.ts). Same
// token-only authorization boundary as /sign/[token]: knowing view_token
// is knowing the invoice, resolved via the admin client since there's no
// session to satisfy RLS with.
export default async function PublicInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ paid?: string }>;
}) {
  const { token } = await params;
  const { paid: justPaid } = await searchParams;
  const supabase = createAdminClient();

  const { data: invoice } = await supabase
    .from("documents")
    // Explicit columns, never "*": this page is public, and documents carries owner-only fields.
    .select("user_id, status, payment_disputed, document_number, issue_date, due_date, subtotal, hst_amount, total_amount, place_of_work, notes, payments(amount), items:document_items(*), client:clients(name, email, address), job:jobs(name)")
    .eq("view_token", token)
    .eq("type", "invoice")
    .maybeSingle();

  if (!invoice) notFound();

  const { data: profile } = await supabase
    .from("profiles")
    .select("business_name, business_email, business_phone, business_address, business_number, logo_url, subscription_status, stripe_connect_account_id, stripe_connect_status, stripe_connect_charges_enabled")
    .eq("id", invoice.user_id)
    .single();

  let logoUrl: string | null = null;
  if (profile?.logo_url) {
    const { data: signed } = await supabase.storage
      .from("logos")
      .createSignedUrl(profile.logo_url, 60 * 60);
    logoUrl = signed?.signedUrl ?? null;
  }

  // "Pay now" is offered only when the server would accept the payment: invoice sent, the
  // owner's Stripe account active, and a balance over $1. The checkout route re-checks all of it.
  const amountPaid = (invoice.payments ?? []).reduce((sum, p) => sum + p.amount, 0);
  const payable = onlinePayableAmount({
    type: "invoice",
    status: invoice.status,
    total: invoice.total_amount,
    paid: amountPaid,
    connectStatus: profile?.stripe_connect_status,
    chargesEnabled: profile?.stripe_connect_charges_enabled,
    hasAccount: Boolean(profile?.stripe_connect_account_id),
    disputed: invoice.payment_disputed,
  });
  const fullyPaid = invoice.status === "paid";

  const business = {
    name: profile?.business_name ?? null,
    email: profile?.business_email ?? "",
    phone: profile?.business_phone ?? null,
    address: profile?.business_address ?? null,
    hstNumber: profile?.business_number ?? null,
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 p-4 py-10">
      <PublicDocumentPaper
        type="invoice"
        documentNumber={invoice.document_number}
        issueDate={invoice.issue_date}
        dueDate={invoice.due_date}
        items={invoice.items ?? []}
        subtotal={invoice.subtotal}
        hstAmount={invoice.hst_amount}
        totalAmount={invoice.total_amount}
        business={business}
        client={invoice.client}
        placeOfWork={invoice.place_of_work}
        notes={invoice.notes}
        jobName={invoice.job?.name ?? null}
        showBrandFooter={showsInvoiceFooter(profile?.subscription_status, "invoice")}
        logoUrl={logoUrl}
      />

      {/* Back from Stripe: wait for the webhook to record the payment (re-reads every 2 s, up to 30 s). */}
      {justPaid && <PaymentConfirmation settled={fullyPaid} />}
      {fullyPaid && !justPaid && (
        <div className="rounded-lg border border-success/40 bg-success/10 p-4 text-center text-sm text-success">
          This invoice has been paid in full.
        </div>
      )}
      {showPayNow({ payable: payable !== null, justPaid: Boolean(justPaid), settled: fullyPaid }) && payable !== null && (
        <PayNowButton
          token={token}
          amountLabel={new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(payable)}
        />
      )}
    </div>
  );
}
