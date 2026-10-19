import type { DocumentType } from "./database.types.ts";

// The small "Created with TaxSnap" credit on a FREE account's invoices - on the
// PDF, the public /invoice page and the emails that carry an invoice. Pro
// removes it. One module so the wording, the link and the who-gets-it rule
// can't drift between those places. Estimates never carry it, and nothing here
// reads or prints any document field (the owner-only internal notes stay out).
export const INVOICE_FOOTER_TEXT = "Created with TaxSnap";
export const INVOICE_FOOTER_URL = "https://gettaxsnap.ca/?src=invoice-footer";

// Only Free-plan invoices. Any stored plan other than "pro" counts as Free,
// the same rule normalizeTier applies everywhere else.
export function showsInvoiceFooter(
  plan: string | null | undefined,
  type: DocumentType | string,
): boolean {
  return type === "invoice" && plan !== "pro";
}
