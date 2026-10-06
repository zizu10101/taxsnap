// Tunables and the feature gate for card-statement import. Pure and import-free
// so it unit-tests with plain `node --test`.

// Limits. A statement is split in the browser into chunks that are posted one
// at a time, so each request stays under the host's request-body limit and
// inside one function invocation.
export const STATEMENT_MAX_PAGES = 30;
export const STATEMENT_MAX_FILE_BYTES = 20 * 1024 * 1024; // whole statement
export const STATEMENT_CHUNK_PAGES = 3;
// Vercel rejects request bodies over ~4.5 MB, so a chunk stays under 4 MB.
export const STATEMENT_CHUNK_MAX_BYTES = 4 * 1024 * 1024;
export const STATEMENT_MAX_LINES = 500;
// A PDF we can't split is sent whole as ONE chunk, so its lines must fit one
// reply. About 50 lines fit on a dense statement page, and a statement is capped
// at STATEMENT_MAX_LINES (500): 500 / 50 = 10 pages.
export const STATEMENT_WHOLE_FILE_MAX_PAGES = 10;
// Extraction attempts per chunk before the user has to start over (each attempt
// is billed; the client auto-retries twice, the rest are manual).
export const STATEMENT_CHUNK_MAX_ATTEMPTS = 6;
// Drafts untouched for this long are purged by the daily cron.
export const STATEMENT_STALE_DRAFT_DAYS = 14;
// A receipt is a match candidate when its date is within this many days.
export const STATEMENT_MATCH_WINDOW_DAYS = 3;

// The feature is on only for the user ids in STATEMENT_IMPORT_USER_IDS
// (comma-separated). No wildcard on purpose: it stays off for everyone until
// the monthly caps are set from measured token costs.
export function parseStatementAllowlist(raw: string | undefined | null): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((id) => id.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isStatementImportEnabled(
  userId: string | null | undefined,
  raw: string | undefined | null = process.env.STATEMENT_IMPORT_USER_IDS,
): boolean {
  if (!userId) return false;
  return parseStatementAllowlist(raw).has(userId.toLowerCase());
}
