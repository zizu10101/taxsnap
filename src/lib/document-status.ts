// Which document statuses the owner may set BY HAND.
//
// 'partial' and 'paid' are derived from the payments recorded against an
// invoice (statusFromPaid in payments.ts, recomputed by every payment route).
// Letting the owner pick them manually produced an invoice that read "Paid"
// with no payment behind it - and since revenue and the HST helper are built
// from payments only, it counted for nothing. So the document routes refuse
// them; the way to get there is to record a payment.

export const MANUAL_DOCUMENT_STATUSES = ["draft", "sent"] as const;
export const PAYMENT_DRIVEN_STATUSES = ["partial", "paid"] as const;

export type ManualDocumentStatus = (typeof MANUAL_DOCUMENT_STATUSES)[number];

/**
 * Validates a status that arrived in a create/update request.
 * Returns null when it is absent or allowed, otherwise the 400 message.
 */
export function validateManualStatus(status: unknown): string | null {
  if (status === undefined || status === null || status === "") return null;

  if (typeof status === "string" && (PAYMENT_DRIVEN_STATUSES as readonly string[]).includes(status)) {
    return `Status can't be set to "${status}" by hand - it follows the payments recorded on the invoice. Record a payment instead.`;
  }
  if (typeof status !== "string" || !(MANUAL_DOCUMENT_STATUSES as readonly string[]).includes(status)) {
    return `Status must be one of: ${MANUAL_DOCUMENT_STATUSES.join(", ")}.`;
  }
  return null;
}
