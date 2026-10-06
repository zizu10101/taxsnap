// Maps a failed Gemini call on a statement chunk to a stable code, an HTTP status
// and a user-safe message. Pure, so it is unit-tested. The raw upstream text is
// never sent to the client.

export type ProviderFailureCode =
  | "PROVIDER_BUSY"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_TIMEOUT"
  | "UNREADABLE_FILE"
  | "PROVIDER_ERROR";

export interface ProviderFailure {
  code: ProviderFailureCode;
  httpStatus: number;
  message: string;
}

export function describeProviderFailure(err: unknown): ProviderFailure {
  const e = (err && typeof err === "object" ? err : {}) as { name?: unknown; status?: unknown; message?: unknown };

  if (e.name === "AbortError" || e.name === "TimeoutError") {
    return { code: "PROVIDER_TIMEOUT", httpStatus: 504, message: "Reading these pages took too long. Try again." };
  }
  if (e.status === 503) {
    return { code: "PROVIDER_BUSY", httpStatus: 503, message: "Statement reading is busy right now. Try again in a minute." };
  }
  if (e.status === 429) {
    return {
      code: "PROVIDER_RATE_LIMIT",
      httpStatus: 429,
      message: "Statement reading is temporarily rate limited. Try again shortly.",
    };
  }
  // A 400 is Google refusing the document itself (an unreadable or password-
  // protected PDF comes back as INVALID_ARGUMENT) - retrying can't help. The one
  // 400 that is NOT about the file is a bad/revoked API key, which is ours to fix.
  if (e.status === 400 && !/api key/i.test(String(e.message ?? ""))) {
    return {
      code: "UNREADABLE_FILE",
      httpStatus: 422,
      message: "We couldn't read this file. It may be password-protected or damaged.",
    };
  }
  return {
    code: "PROVIDER_ERROR",
    httpStatus: 502,
    message: "Statement reading is unavailable right now. Try again shortly.",
  };
}
