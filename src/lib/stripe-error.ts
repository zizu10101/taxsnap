// Turning a Stripe SDK error into something safe to log and to hint at in a JSON
// response. Import-free (duck-typed, no `stripe` import) so it can be unit-tested
// with `node --test`.
//
// Logged: the error's type, code, param, message and request id - the five things
// that identify a Stripe failure in the Dashboard's request log. NEVER logged: the
// API key, webhook secrets or request bodies. The message is scrubbed of anything
// shaped like a key or secret first (Stripe itself masks keys in its messages, this
// is belt and braces).
// Returned to the browser: only `code` - never the message text.

export interface StripeErrorInfo {
  type: string;
  code: string | null;
  param: string | null;
  message: string;
  requestId: string | null;
  statusCode: number | null;
}

const SECRET_PATTERN = /\b(?:sk|rk|pk|whsec)_(?:live_|test_)?[A-Za-z0-9*_]+/g;

export function redactSecrets(text: string): string {
  return text.replace(SECRET_PATTERN, "[redacted]");
}

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

export function describeStripeError(err: unknown): StripeErrorInfo {
  if (typeof err === "object" && err !== null) {
    const e = err as Record<string, unknown>;
    // Stripe errors carry `rawType` (e.g. "invalid_request_error") next to `type`
    // (the class name, e.g. "StripeInvalidRequestError").
    const type = str(e.rawType) ?? str(e.type) ?? str(e.name) ?? "Error";
    return {
      type,
      code: str(e.code),
      param: str(e.param),
      message: redactSecrets(typeof e.message === "string" ? e.message : String(err)),
      requestId: str(e.requestId),
      statusCode: typeof e.statusCode === "number" ? e.statusCode : null,
    };
  }
  return { type: "Error", code: null, param: null, message: redactSecrets(String(err)), requestId: null, statusCode: null };
}

// One line, grep-able: "[stripe-error] connect/start create-account type=... code=...".
export function logStripeError(context: string, err: unknown): StripeErrorInfo {
  const info = describeStripeError(err);
  console.error(
    `[stripe-error] ${context} type=${info.type} code=${info.code ?? "-"} param=${info.param ?? "-"} ` +
      `status=${info.statusCode ?? "-"} requestId=${info.requestId ?? "-"} message=${JSON.stringify(info.message)}`,
  );
  return info;
}

// What the browser may see: the Stripe code (or, when Stripe gave none, the error
// type) - a short identifier, not message text.
export function stripeErrorCode(err: unknown): string {
  const info = describeStripeError(err);
  return info.code ?? info.type;
}

// ------------------------------------------------------------------ dev startup log

export function keyPrefix(key: string): string {
  return key.slice(0, 7);
}

export function shouldLogStripeStartup(env: { NODE_ENV?: string; NEXT_RUNTIME?: string }, key: string | undefined): boolean {
  return env.NODE_ENV === "development" && env.NEXT_RUNTIME !== "edge" && Boolean(key);
}
