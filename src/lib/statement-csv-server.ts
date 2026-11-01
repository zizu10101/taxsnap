import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./database.types.ts";
import {
  STATEMENT_CSV_MAX_ROWS,
  checkBalances,
  coerceStatementRow,
  headerBalances,
  isAmountLayout,
  isSignConvention,
  moneyTotals,
  planStatementCsvRows,
  type PlannedCsvRow,
  type StatementCsvRow,
} from "./statement-csv.ts";
import { isStatementImportEnabled } from "./statement-config.ts";
import { mapStatementDbError } from "./statement-errors.ts";
import { selectAll } from "./select-all.ts";
import { isIsoDate } from "./statement-lines.ts";
import { STATEMENTS_HREF, statementHref } from "./statement-routes.ts";
import { loadCategoryRows } from "./statement-bank-charges.ts";
import { bankChargesSuggestion, resolveBankCharges } from "./statement-categories.ts";

// The server half of "Import CSV" in the card statement import. The browser parses the file and sends only
// the mapped rows plus a few statement-level fields; the file itself is never sent or stored. EVERYTHING is
// decided again here from the session's user id and those plain values: the allowlist, the row cap, the
// account (it must be the caller's own and active), the amounts and their signs, the dates, the total rows,
// and which lines are already imported.
//
//   preview  {mode:"preview", account_id, file_sha256, layout, convention, rows, period_start?, period_end?,
//             opening_balance?, closing_balance?}   the plan for every row; nothing is written
//   apply    {mode:"apply", ...same}               creates the draft import, saves the lines, fingerprints and
//                                                  flags them, applies the user's choices, auto-matches receipts
//
// Apply lands on the SAME review screen as a PDF import (statement_imports / statement_lines are shared), so
// nothing is saved as an expense until the person commits there. No statement text, description or amount is
// ever logged or returned in an error: failures carry fixed wording and row numbers.

type Db = SupabaseClient<Database>;
export interface HandlerResult {
  status: number;
  body: Record<string, unknown>;
}

export interface StatementCsvDeps {
  /** The caller's own session client: every read goes through it (RLS), re-filtered on user_id. */
  read: Db;
  /** The service client: the only writer of the statement tables. Only ever given the session's user id. */
  admin: Db;
  /** Accepts the saved lines (receipt auto-match, as after a PDF import). Injected so the handler tests without a request. */
  matchLines: (importId: string) => Promise<number>;
  /** STATEMENT_IMPORT_USER_IDS; undefined reads the environment. */
  allowlist?: string | null;
}

const SHA = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_BATCH = 200;
const MAX_BALANCE = 999_999_999;

// The fingerprint the database builds in finalize_statement_lines (0052):
//   md5(account_id::text || '|' || txn_date::text || '|' || amount::text || '|' || n::text)
// amount is numeric(12,2), so its text always has two decimals ("5.00", "-12.50"); n is the line's place
// among the lines with the same date and amount, in file order. Identical to the PDF path's, so a CSV line and
// the same line read from a PDF of the same account are the same line. It leaves out the description.
export function lineFingerprint(accountId: string, date: string, amount: number, nth: number): string {
  return createHash("md5").update(`${accountId}|${date}|${amount.toFixed(2)}|${nth}`).digest("hex");
}

const isResult = (v: unknown): v is HandlerResult => typeof v === "object" && v !== null && "status" in v && "body" in v;
const fail = (status: number, error: string, code?: string): HandlerResult => ({ status, body: { error, ...(code && { code }) } });

function readBalance(value: unknown): { value: number | null } | HandlerResult {
  if (value === undefined || value === null || value === "") return { value: null };
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > MAX_BALANCE) {
    return fail(400, "Opening and closing balances must be amounts.");
  }
  return { value: Math.round(value * 100) / 100 };
}

function readDate(value: unknown): { value: string | null } | HandlerResult {
  if (value === undefined || value === null || value === "") return { value: null };
  return isIsoDate(value) ? { value } : fail(400, "The statement period isn't a valid date.");
}

interface Prepared {
  planned: PlannedCsvRow[];
  /** Rows that become lines, in file order (line_no = position + 1). */
  stored: { planned: PlannedCsvRow; input: StatementCsvRow; fingerprint: string }[];
  accountId: string;
  accountType: "bank" | "card";
  convention: "bank" | "card";
}

async function prepare(deps: StatementCsvDeps, userId: string, b: Record<string, unknown>, now: Date): Promise<Prepared | HandlerResult> {
  const rawRows = b.rows;
  if (!Array.isArray(rawRows) || rawRows.length === 0) return fail(400, "There are no rows to import.");
  if (rawRows.length > STATEMENT_CSV_MAX_ROWS) {
    return fail(400, `A statement CSV can have at most ${STATEMENT_CSV_MAX_ROWS.toLocaleString("en-CA")} rows. Split it into smaller files.`, "TOO_MANY_ROWS");
  }
  if (!isAmountLayout(b.layout)) return fail(400, "Choose how the amounts are laid out.");
  if (!isSignConvention(b.convention)) return fail(400, "Choose how the amounts are signed.");
  if (typeof b.file_sha256 !== "string" || !SHA.test(b.file_sha256)) return fail(400, "Invalid file fingerprint.");
  if (typeof b.account_id !== "string" || !UUID.test(b.account_id)) {
    return fail(400, "Choose the account this statement is for.", "ACCOUNT_NOT_FOUND");
  }

  // The account: the caller's own, and still in use. Ownership is checked here AND inside the starter function.
  const { data: account, error: accountError } = await deps.read
    .from("bank_accounts")
    .select("id, account_type, is_active")
    .eq("id", b.account_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (accountError) throw new Error("load-account");
  if (!account || !account.is_active) return fail(400, "Choose the account this statement is for.", "ACCOUNT_NOT_FOUND");

  const inputs = rawRows.map(coerceStatementRow);
  const planned = planStatementCsvRows(inputs, { layout: b.layout, convention: b.convention, now });

  // Lines already imported for this account: the committed ones that still stand behind an expense or a match
  // (the same condition finalize_statement_lines uses). Dates bound the read; every page is read.
  const dates = planned.flatMap((p) => (p.line ? [p.line.txn_date] : [])).sort();
  const existing = new Set<string>();
  if (dates.length > 0) {
    const { rows } = await selectAll(() =>
      deps.read
        .from("statement_lines")
        .select("line_fingerprint")
        .eq("user_id", userId)
        .eq("account_id", account.id)
        .eq("committed", true)
        .in("resolution", ["matched", "new_expense"])
        .gte("txn_date", dates[0])
        .lte("txn_date", dates[dates.length - 1])
        .order("id"),
    );
    for (const r of rows) if (r.line_fingerprint) existing.add(r.line_fingerprint);
  }

  // Which rows become lines. A total row only when the person ticked it; an error or $0 row never. A flagged
  // duplicate is STORED either way (it must be: removing it would change the "nth" of the next identical
  // line), and starts skipped unless ticked.
  const stored: Prepared["stored"] = [];
  const seen = new Map<string, number>();
  planned.forEach((p, i) => {
    if (!p.line) return;
    if (p.status === "total" && inputs[i].import_anyway !== true) return;
    if (p.status !== "ready" && p.status !== "total") return;
    const key = `${p.line.txn_date}|${p.line.amount.toFixed(2)}`;
    const nth = (seen.get(key) ?? 0) + 1;
    seen.set(key, nth);
    const fingerprint = lineFingerprint(account.id, p.line.txn_date, p.line.amount, nth);
    if (p.status === "ready" && existing.has(fingerprint)) {
      p.status = "duplicate";
      p.messages = ["Already imported: this line is in a saved statement"];
    }
    stored.push({ planned: p, input: inputs[i], fingerprint });
  });

  return {
    planned,
    stored,
    accountId: account.id,
    accountType: account.account_type === "card" ? "card" : "bank",
    convention: b.convention,
  };
}

export async function handleStatementCsv(
  deps: StatementCsvDeps,
  userId: string,
  body: unknown,
  now: Date = new Date(),
): Promise<HandlerResult> {
  // Same gate as every other statement route, checked here too. 404 (not 403), like requireStatementUser, so the
  // feature's existence isn't revealed to anyone it's off for.
  if (!isStatementImportEnabled(userId, deps.allowlist)) return fail(404, "Not found");
  if (typeof body !== "object" || body === null) return fail(400, "Could not read the request.");
  const b = body as Record<string, unknown>;
  if (b.mode !== "preview" && b.mode !== "apply") return fail(400, "Unknown request.");

  const start = readDate(b.period_start);
  if (isResult(start)) return start;
  const end = readDate(b.period_end);
  if (isResult(end)) return end;
  if (start.value && end.value && end.value < start.value) return fail(400, "The statement period ends before it starts.");
  const opening = readBalance(b.opening_balance);
  if (isResult(opening)) return opening;
  const closing = readBalance(b.closing_balance);
  if (isResult(closing)) return closing;

  let prepared: Awaited<ReturnType<typeof prepare>>;
  try {
    prepared = await prepare(deps, userId, b, now);
  } catch {
    return fail(500, "Could not check the import. Please try again.");
  }
  if (isResult(prepared)) return prepared;
  const { planned, stored, accountId, convention } = prepared;

  // Money out / money in over the lines that become the statement (what the review's balance check will see).
  const totals = moneyTotals(stored.map((s) => s.planned.line!.amount));
  const balance = checkBalances({ opening: opening.value, closing: closing.value, totals, convention });

  if (b.mode === "preview") {
    return { status: 200, body: { rows: planned, totals, balance, account_type: prepared.accountType } };
  }

  // ---- apply
  if (stored.length === 0) return fail(400, "There is nothing to import.");

  let importId: string;
  const started = await deps.admin.rpc("start_statement_csv_import", {
    p_user_id: userId,
    p_account_id: accountId,
    p_file_sha256: b.file_sha256 as string,
  });
  if (started.error) {
    // 23505 = the one-open-draft-per-file index: an earlier attempt with this file never finished. Reuse that
    // draft - save_chunk_result replaces the chunk's lines, so nothing is doubled.
    if (started.error.code !== "23505") {
      const mapped = mapStatementDbError(started.error);
      return {
        status: mapped.status,
        body: { error: mapped.message, code: mapped.code, ...(mapped.code === "ALREADY_IMPORTED" && { statements_href: STATEMENTS_HREF }) },
      };
    }
    const { data: open } = await deps.read
      .from("statement_imports")
      .select("id")
      .eq("user_id", userId)
      .eq("file_sha256", b.file_sha256 as string)
      .eq("status", "draft")
      .maybeSingle();
    if (!open) return fail(500, "Couldn't start the import. Please try again.");
    importId = open.id;
  } else {
    importId = started.data as string;
  }

  const discard = async () => {
    await deps.admin.rpc("discard_statement_import", { p_user_id: userId, p_import_id: importId });
  };

  // Fee and interest lines take the PDF path's route: the owner's "Bank charges" category is suggested (found by its
  // stable key, so a renamed one works and a removed one suggests nothing - statement-categories.ts), and the
  // no-tax default for fees and interest then applies from the line's kind (tax-codes.ts resolveTaxCode). Read only
  // when such a line exists.
  const needsBankCharges = stored.some((s) => s.planned.line!.kind === "fee" || s.planned.line!.kind === "interest");
  const bankCharges = needsBankCharges
    ? bankChargesSuggestion(resolveBankCharges(await loadCategoryRows(deps.read, userId)))
    : null;

  const lines = stored.map((s, i) => ({
    page: 1,
    line_no: i + 1,
    txn_date: s.planned.line!.txn_date,
    description: s.planned.line!.description,
    amount: s.planned.line!.amount,
    kind: s.planned.line!.kind,
    currency: "CAD",
    original_amount: null,
    original_currency: null,
    suggested_category: s.planned.line!.kind === "fee" || s.planned.line!.kind === "interest" ? bankCharges : null,
  }));
  const header = {
    period_start: start.value,
    period_end: end.value,
    ...headerBalances(opening.value, closing.value, convention),
  };

  const saved = await deps.admin.rpc("save_chunk_result", {
    p_user_id: userId,
    p_import_id: importId,
    p_chunk_no: 1,
    p_lines: lines as unknown as Json,
    p_header: header as unknown as Json,
    p_input_tokens: 0,
    p_output_tokens: 0,
  });
  if (saved.error) {
    await discard();
    const mapped = mapStatementDbError(saved.error);
    return fail(mapped.status, mapped.message, mapped.code);
  }

  const finalized = await deps.admin.rpc("finalize_statement_lines", { p_user_id: userId, p_import_id: importId });
  if (finalized.error) {
    await discard();
    const mapped = mapStatementDbError(finalized.error);
    return fail(mapped.status, mapped.message, mapped.code);
  }

  // The person's choices from the preview, applied to the finalized lines (line_no = position in `stored`).
  //  - a flagged duplicate they ticked: Import anyway (override, back to undecided like the review screen does)
  //  - a plain row they unticked: skipped
  const overrideNos: number[] = [];
  const skipNos: number[] = [];
  stored.forEach((s, i) => {
    if (s.planned.status === "duplicate" && s.input.import_anyway === true) overrideNos.push(i + 1);
    else if (s.planned.status === "ready" && s.input.skip === true) skipNos.push(i + 1);
  });
  try {
    for (let i = 0; i < overrideNos.length; i += ID_BATCH) {
      const { error } = await deps.admin
        .from("statement_lines")
        .update({ duplicate_override: true, resolution: null })
        .eq("import_id", importId)
        .eq("user_id", userId)
        .in("line_no", overrideNos.slice(i, i + ID_BATCH))
        .not("duplicate_of_line_id", "is", null);
      if (error) throw new Error("override");
    }
    for (let i = 0; i < skipNos.length; i += ID_BATCH) {
      const { error } = await deps.admin
        .from("statement_lines")
        .update({ resolution: "skipped" })
        .eq("import_id", importId)
        .eq("user_id", userId)
        .in("line_no", skipNos.slice(i, i + ID_BATCH));
      if (error) throw new Error("skip");
    }
  } catch {
    // The lines are saved and fingerprinted; only the preview's choices did not land. Say so, keep the draft:
    // the review screen is where each of these is one click.
    return {
      status: 200,
      body: { import_id: importId, href: statementHref(importId), line_count: stored.length, choices_applied: false },
    };
  }

  let autoMatched = 0;
  try {
    autoMatched = await deps.matchLines(importId);
  } catch {
    // Matching is a convenience: the review screen offers every match the person can make by hand.
  }
  return {
    status: 200,
    body: {
      import_id: importId,
      href: statementHref(importId),
      line_count: finalized.data ?? stored.length,
      auto_matched: autoMatched,
      choices_applied: true,
    },
  };
}
