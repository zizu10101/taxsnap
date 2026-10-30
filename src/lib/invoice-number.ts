// The optional "Invoice / receipt number" on an expense (receipts.invoice_number).
//
// Two different jobs, kept as two functions so they can't be confused:
//   cleanInvoiceNumber      what is STORED and shown: the number as printed, minus anything unsafe.
//   normalizeInvoiceNumber  what is COMPARED for the duplicate warning: INV-0042, inv 0042 and
//                           "INV 0042 " are the same invoice.
// Pure, no imports, so the API routes, the review screen and the tests share one rule.

export const INVOICE_NUMBER_MAX = 40;

// ASCII control characters and C1 controls (newlines and tabs included): never wanted in a number
// that ends up in a CSV cell, a table and a log line.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

// Trim, strip control characters, cap at INVOICE_NUMBER_MAX, and turn "nothing left" into null.
// Anything that is not a string (a number from a client, undefined, an object) is null: this is
// what the API stores, so it never throws on a bad request body.
export function cleanInvoiceNumber(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(CONTROL_CHARS, "").trim().slice(0, INVOICE_NUMBER_MAX).trim();
  return cleaned === "" ? null : cleaned;
}

// The comparison key: upper case, every space and punctuation mark dropped (letters and digits
// only), then leading zeros dropped. null when nothing is left to compare (blank, only punctuation,
// or all zeros), which is what makes the duplicate check skip a blank number.
//
// Leading zeros are only dropped from the very start of the key ("000123" matches "123"); a zero
// inside it or after a letter prefix is kept, so "INV-0042" and "INV-42" are NOT the same here.
// That is a deliberate miss in the safe direction: it is only a warning, and "A0" vs "A" should not
// be told apart less carefully than "00" vs "0".
export function normalizeInvoiceNumber(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, "")
    .replace(/^0+/, "");
  return key === "" ? null : key;
}

// A superset-matching ILIKE pattern for the database's coarse pre-filter: the key's characters in
// order with a wildcard between them. Normalising only ever REMOVES characters, so every stored
// number whose key equals this one also matches the pattern; the exact comparison is then done in
// code with normalizeInvoiceNumber. Letters and digits only, so nothing needs escaping.
export function invoiceNumberLikePattern(key: string): string {
  return `%${[...key].join("%")}%`;
}
