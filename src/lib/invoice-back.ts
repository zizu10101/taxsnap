// Where the "Back" link on an invoice's detail page goes.
//
// An invoice can be reached from the Invoices list OR from Progress Billing
// (a progress draw is an ordinary invoice). The page used to guess from the
// document itself, so a draw opened from the Invoices list sent you to
// Progress Billing. Now the link you came from says where you came from:
//   /dashboard/invoices/<id>?from=invoices
//   /dashboard/invoices/<id>?from=progress-billing
//   /dashboard/invoices/<id>?from=progress-billing:<job id>   (back to that job's summary)
// and no/unknown value means Invoices.
//
// The value is looked up in a fixed table and never used as a URL itself, so
// it can't be turned into an open redirect or a link to some other page.

export type InvoiceBackSource = "invoices" | "progress-billing" | `progress-billing:${string}`;

export interface InvoiceBack {
  href: string;
  label: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const INVOICES: InvoiceBack = { href: "/dashboard/invoices", label: "invoices" };
const PROGRESS_BILLING: InvoiceBack = { href: "/dashboard/progress-billing", label: "Progress Billing" };

/** `raw` is whatever Next hands the page for ?from= (string, repeated param, or absent). */
export function resolveInvoiceBack(raw: string | string[] | undefined | null): InvoiceBack {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === "progress-billing") return PROGRESS_BILLING;
  if (value?.startsWith("progress-billing:")) {
    const jobId = value.slice("progress-billing:".length);
    if (UUID.test(jobId)) {
      return { href: `/dashboard/progress-billing/${jobId.toLowerCase()}`, label: "Progress Billing" };
    }
    return PROGRESS_BILLING;
  }
  return INVOICES;
}

/** The link that opens an invoice, remembering where the click came from. */
export function invoiceDetailHref(id: string, from: InvoiceBackSource = "invoices"): string {
  return `/dashboard/invoices/${id}?from=${encodeURIComponent(from)}`;
}
