// A client's optional phone number (clients.phone, migration 0072). Internal contact info only: it is never
// printed on an invoice, estimate, PDF or public page, and never sent to the client portal, an email or an export.
// Pure, so the create/edit routes, the import and the tests share one rule.

export const CLIENT_PHONE_MAX_LENGTH = 40;

// Digits, spaces and + - ( ) . , optionally followed by an extension ("ext", "ext." and digits).
const PHONE_RE = /^[0-9+\-().\s]*(?:ext\.?\s*\d+)?$/i;

const EXT_RE = /ext\.?\s*\d+$/i;

export type PhoneResult = { ok: true; value: string | null } | { ok: false; error: string };

export const INVALID_PHONE_MESSAGE =
  "Enter a phone number using digits, spaces and + - ( ) . (and ext 123 for an extension), up to 40 characters.";

// Trims; empty means null; anything else must be short enough, use only the allowed characters and have a digit before any extension.
export function normalizePhone(raw: unknown): PhoneResult {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, error: INVALID_PHONE_MESSAGE };
  const value = raw.trim();
  if (value === "") return { ok: true, value: null };
  if (value.length > CLIENT_PHONE_MAX_LENGTH || !PHONE_RE.test(value) || !/\d/.test(value.replace(EXT_RE, ""))) {
    return { ok: false, error: INVALID_PHONE_MESSAGE };
  }
  return { ok: true, value };
}

// A tel: link target: digits and a leading +, extension dropped (a tel: link can't carry "ext").
export function telHref(phone: string): string {
  const main = phone.replace(EXT_RE, "");
  const plus = main.trim().startsWith("+") ? "+" : "";
  return `tel:${plus}${main.replace(/\D/g, "")}`;
}
