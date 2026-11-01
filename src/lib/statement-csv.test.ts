import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { headingsKey } from "./expense-import.ts";
import { isStatementImportEnabled } from "./statement-config.ts";
import {
  STATEMENT_CSV_MAX_ROWS,
  buildStatementRows,
  checkBalances,
  defaultConventionFor,
  guessStatementMapping,
  headerBalances,
  importCameFromCsv,
  layoutFromMapping,
  moneyTotals,
  parseSavedStatementMapping,
  planStatementCsvRows,
  readStatementCsv,
  statementHeadingsKey,
  statementMappingProblems,
  toCardAmount,
  type AmountLayout,
  type SignConvention,
  type StatementCsvRow,
} from "./statement-csv.ts";
import { handleStatementCsv, lineFingerprint } from "./statement-csv-server.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const NOW = new Date("2026-04-10T12:00:00Z");

const row = (over: Partial<StatementCsvRow> = {}): StatementCsvRow => ({
  row: 2,
  date: "2026-03-14",
  description: "Acme Supply",
  reference: "",
  amount: -12.5,
  debit: null,
  credit: null,
  balance: null,
  ...over,
});
const plan = (rows: StatementCsvRow[], layout: AmountLayout = "signed", convention: SignConvention = "bank") =>
  planStatementCsvRows(rows, { layout, convention, now: NOW });

// ---- reading the file ------------------------------------------------------------------------------

test("preamble lines above the column names are set aside, and row numbers stay the file's own", () => {
  const text = [
    "Account Activity",
    "Account: 1234-5678",
    "",
    "Date,Description,Debit,Credit,Balance",
    "2026-03-14,Acme Supply,12.50,,987.50",
    "2026-03-15,Payroll,,2000.00,2987.50",
  ].join("\r\n");
  const f = readStatementCsv(text);
  assert.deepEqual(f.table.headers, ["Date", "Description", "Debit", "Credit", "Balance"]);
  assert.equal(f.preambleLines, 3);
  assert.deepEqual(f.table.rows.map((r) => r.row), [5, 6], "row 5 is the fifth line of the file");
  assert.deepEqual(f.table.rows[0].cells, ["2026-03-14", "Acme Supply", "12.50", "", "987.50"]);
});

test("a one-cell preamble above a semicolon or tab file does not turn it into a comma file", () => {
  for (const sep of [";", "\t"]) {
    const f = readStatementCsv(`Statement for March\n\nDate${sep}Details${sep}Amount\n2026-03-14${sep}Acme${sep}-5.00\n`);
    assert.deepEqual(f.table.headers, ["Date", "Details", "Amount"]);
    assert.equal(f.table.rows[0].cells[2], "-5.00");
  }
});

test("a BOM, blank lines and no preamble work like every other import; no recognisable header = the first row", () => {
  const f = readStatementCsv("﻿\n\nDate,Description,Amount\n2026-03-14,Acme,-5.00\n");
  assert.deepEqual(f.table.headers, ["Date", "Description", "Amount"]);
  assert.equal(f.preambleLines, 2);
  const odd = readStatementCsv("When,What,How much\n2026-03-14,Acme,-5.00\n");
  assert.deepEqual(odd.table.headers, ["When", "What", "How much"]);
  assert.equal(odd.preambleLines, 0);
});

test("headings are guessed for both layouts; a debit AND credit column means the second layout", () => {
  assert.deepEqual(guessStatementMapping(["Date", "Description", "Debit", "Credit", "Balance"]), ["date", "description", "debit", "credit", "balance"]);
  const signed = guessStatementMapping(["Transaction Date", "Details", "Amount", "Running Balance"]);
  assert.deepEqual(signed, ["date", "description", "amount", "balance"]);
  assert.equal(layoutFromMapping(signed), "signed");
  assert.equal(layoutFromMapping(["date", "description", "debit", "credit"]), "debit_credit");
  assert.equal(layoutFromMapping(["date", "description", "debit", "ignore"]), "signed");
});

test("Continue needs a date, a description or reference, and the amount column(s) for the chosen layout", () => {
  assert.deepEqual(statementMappingProblems(["date", "description", "amount"], "signed"), []);
  assert.deepEqual(statementMappingProblems(["date", "reference", "debit", "credit"], "debit_credit"), []);
  assert.equal(statementMappingProblems(["description", "amount"], "signed").length, 1);
  assert.equal(statementMappingProblems(["date", "description", "debit"], "debit_credit").length, 1);
  assert.equal(statementMappingProblems(["date", "amount"], "signed").length, 1);
});

test("the remembered mapping: own key, validated on the way back, nothing claimed twice", () => {
  const headers = ["Date", "Description", "Amount"];
  assert.notEqual(statementHeadingsKey(headers), headingsKey(headers), "never reads the expense import's mapping");
  assert.match(statementHeadingsKey(headers), /^taxsnap-statement-csv-3-/);
  const good = JSON.stringify(["date", "description", "amount"]);
  assert.deepEqual(parseSavedStatementMapping(good, 3), ["date", "description", "amount"]);
  assert.equal(parseSavedStatementMapping(good, 4), null);
  assert.equal(parseSavedStatementMapping(JSON.stringify(["date", "date", "amount"]), 3), null);
  assert.equal(parseSavedStatementMapping(JSON.stringify(["date", "paid_with", "amount"]), 3), null);
  assert.equal(parseSavedStatementMapping("{nope", 3), null);
  assert.equal(parseSavedStatementMapping(null, 3), null);
  assert.match(read("../components/dashboard/statement-csv-button.tsx"), /try \{\s*return window\.localStorage\.getItem/);
});

test("$ amounts, thousands commas, month-name and numeric dates are read; a bad cell is a problem and the rest carry on", () => {
  const f = readStatementCsv(
    ["Date,Description,Amount", '"Jul 2, 2026",Acme,"-$1,234.50"', "2026-07-03,Beta,(45.00)", "not a date,Gamma,5", "2026-07-04,Delta,twelve"].join("\n"),
  );
  const built = buildStatementRows(f.table, ["date", "description", "amount"], { layout: "signed", dateOrder: null });
  assert.deepEqual(built.rows.map((r) => [r.date, r.amount]), [["2026-07-02", -1234.5], ["2026-07-03", -45]]);
  assert.deepEqual(built.problems.map((p) => p.row), [4, 5]);
});

test("a row with more values than headings is a problem, never a shifted amount", () => {
  const f = readStatementCsv("Date,Description,Amount\n2026-03-14,Acme,12,50\n");
  const built = buildStatementRows(f.table, ["date", "description", "amount"], { layout: "signed", dateOrder: null, overflowRows: f.overflowRows });
  assert.equal(built.rows.length, 0);
  assert.equal(built.problems.length, 1);
});

// ---- amounts and signs -----------------------------------------------------------------------------

test("one signed column, BANK convention: negative = money out. The stored amount is money-out-positive", () => {
  const [out, inn] = plan([row({ amount: -12.5 }), row({ row: 3, amount: 2000 })], "signed", "bank");
  assert.deepEqual([out.status, out.line?.amount, out.line?.kind], ["ready", 12.5, "purchase"]);
  assert.deepEqual([inn.status, inn.line?.amount, inn.line?.kind], ["ready", -2000, "payment"]);
});

test("one signed column, CARD convention: positive = a charge. The stored amount is the file's own", () => {
  const [charge, credit] = plan([row({ amount: 12.5 }), row({ row: 3, amount: -300 })], "signed", "card");
  assert.deepEqual([charge.line?.amount, charge.line?.kind], [12.5, "purchase"]);
  assert.deepEqual([credit.line?.amount, credit.line?.kind], [-300, "payment"]);
});

test("the same bank file read with the wrong convention swaps money out and money in (what the preview totals expose)", () => {
  const rows = [row({ amount: -100 }), row({ row: 3, amount: -50 }), row({ row: 4, amount: 400 })];
  const total = (c: SignConvention) => moneyTotals(plan(rows, "signed", c).map((p) => p.line!.amount));
  assert.deepEqual([total("bank").out, total("bank").in], [150, 400]);
  assert.deepEqual([total("card").out, total("card").in], [400, 150]);
});

test("debit/credit layout: debit is money out, credit is money in, whatever the account; both filled is an error", () => {
  for (const convention of ["bank", "card"] as const) {
    const [d, c, both, none] = plan(
      [
        row({ amount: null, debit: 20, credit: null }),
        row({ row: 3, amount: null, debit: null, credit: 75.25 }),
        row({ row: 4, amount: null, debit: 5, credit: 5 }),
        row({ row: 5, amount: null }),
      ],
      "debit_credit",
      convention,
    );
    assert.deepEqual([d.line?.amount, d.line?.kind], [20, "purchase"], convention);
    assert.deepEqual([c.line?.amount, c.line?.kind], [-75.25, "payment"], convention);
    assert.deepEqual([both.status, both.messages], ["error", ["Both Debit and Credit are filled"]]);
    assert.deepEqual([none.status, none.messages], ["error", ["No amount"]]);
  }
  assert.deepEqual(toCardAmount(row({ debit: -20, credit: 0, amount: null }), "debit_credit", "bank"), { state: "ok", value: 20 }, "a sign in a debit column is ignored");
});

test("the dropdown starts on the account's own convention", () => {
  assert.equal(defaultConventionFor("card"), "card");
  assert.equal(defaultConventionFor("bank"), "bank");
  assert.equal(defaultConventionFor(null), "bank");
});

test("a $0.00 line is left out, like the PDF path; dates in the future and blank descriptions are errors", () => {
  const p = plan([
    row({ amount: 0 }),
    row({ row: 3, date: "2026-12-31" }),
    row({ row: 4, description: "  ", reference: "" }),
    row({ row: 5, description: "", reference: "CHQ 1042" }),
    row({ row: 6, date: "" }),
  ]);
  assert.deepEqual(p.map((x) => x.status), ["ignored", "error", "error", "ready", "error"]);
  assert.equal(p[3].line?.description, "CHQ 1042", "the reference describes a line with no description");
});

test("card numbers in a description are masked before anything is stored", () => {
  const [p] = plan([row({ description: "PAYMENT 4111 1111 1111 1111 THANK YOU" })]);
  assert.match(p.line!.description, /\*{4}1111/);
  assert.doesNotMatch(p.line!.description, /4111 1111/);
});

// ---- total rows ------------------------------------------------------------------------------------

test("a total row is flagged and not importable by default; the usual rules (label, bare amount, sum) apply", () => {
  const p = plan([
    row({ row: 2, amount: -10, description: "Acme" }),
    row({ row: 3, amount: -20, description: "Beta" }),
    row({ row: 4, amount: -35, description: "Gamma" }),
    row({ row: 5, date: "", description: "Total", amount: -65 }),
    row({ row: 6, date: "", description: "", amount: -1 }),
  ]);
  assert.deepEqual(p.map((x) => x.status), ["ready", "ready", "ready", "total", "total"]);
  assert.match(p[3].messages[0], /Looks like a total row/);
  assert.equal(p[3].line, null, "no date: nothing to build a line from");
  const dated = plan([row({ description: "Grand Total", amount: -99 })]);
  assert.equal(dated[0].status, "total");
  assert.equal(dated[0].line?.amount, 99, "a dated one can still be imported on purpose");
});

// ---- balances --------------------------------------------------------------------------------------

test("balance check: bank = opening + in - out, card = opening + charges - payments; whole cents; unchecked without both", () => {
  const totals = moneyTotals([100.1, 50.2, -400]); // out 150.30, in 400
  assert.deepEqual(checkBalances({ opening: 1000, closing: 1249.7, totals, convention: "bank" }), { state: "ok", expected: 1249.7 });
  const off = checkBalances({ opening: 1000, closing: 1250, totals, convention: "bank" });
  assert.deepEqual(off, { state: "off", expected: 1249.7, diff: 0.3 });
  assert.deepEqual(checkBalances({ opening: 500, closing: 250.3, totals, convention: "card" }), { state: "ok", expected: 250.3 });
  assert.deepEqual(checkBalances({ opening: 500, closing: null, totals, convention: "bank" }), { state: "unchecked" });
});

test("balances are stored the way the PDF path stores them, so the review's balance roll agrees", () => {
  assert.deepEqual(headerBalances(1000, 1249.7, "bank"), { opening_balance: -1000, closing_balance: -1249.7 });
  assert.deepEqual(headerBalances(500, 250.3, "card"), { opening_balance: 500, closing_balance: 250.3 });
  assert.deepEqual(headerBalances(1000, null, "bank"), { opening_balance: null, closing_balance: null });
});

// ---- the fingerprint -------------------------------------------------------------------------------

test("the fingerprint is the database's: md5(account|date|amount to 2 places|nth), money-out positive", () => {
  const a = "11111111-1111-4111-8111-111111111111";
  assert.equal(lineFingerprint(a, "2026-03-14", 12.5, 1), createHash("md5").update(`${a}|2026-03-14|12.50|1`).digest("hex"));
  assert.equal(lineFingerprint(a, "2026-03-14", -5, 2), createHash("md5").update(`${a}|2026-03-14|-5.00|2`).digest("hex"));
  const sql = read("../../supabase/migrations/0052_statement_import.sql");
  assert.ok(sql.includes("l.account_id::text || '|' || l.txn_date::text || '|' || l.amount::text || '|' || t.n::text"), "finalize still builds it this way");
  assert.ok(sql.includes("partition by txn_date, amount order by page, line_no"), "and numbers repeats this way");
});

// ---- the handler -----------------------------------------------------------------------------------

type Row = Record<string, unknown>;
const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const BANK = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CARD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const THEIRS = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GONE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SHA = "a".repeat(64);

function makeDeps(opts: { lines?: Row[]; startError?: { message?: string; code?: string }; allowlist?: string | null } = {}) {
  const accounts: Row[] = [
    { id: BANK, user_id: ME, account_type: "bank", is_active: true },
    { id: CARD, user_id: ME, account_type: "card", is_active: true },
    { id: THEIRS, user_id: OTHER, account_type: "bank", is_active: true },
    { id: GONE, user_id: ME, account_type: "bank", is_active: false },
  ];
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const updates: { values: Row; filters: Record<string, unknown> }[] = [];
  const tables: string[] = [];
  const builder = (table: string, rowsOf: () => Row[]) => {
    const filters: ((r: Row) => boolean)[] = [];
    const seen: Record<string, unknown> = {};
    let update: Row | null = null;
    let range: [number, number] | null = null;
    const b = {
      select: () => b,
      update: (v: Row) => ((update = v), b),
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), (seen[c] = v), b),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), (seen[c] = v), b),
      not: () => b,
      gte: (c: string, v: string) => (filters.push((r) => String(r[c]) >= v), b),
      lte: (c: string, v: string) => (filters.push((r) => String(r[c]) <= v), b),
      order: () => b,
      range: (a: number, z: number) => ((range = [a, z]), b),
      maybeSingle: () => Promise.resolve({ data: rowsOf().find((r) => filters.every((f) => f(r))) ?? null, error: null }),
      then: (resolve: (v: { data: unknown; error: unknown }) => void) => {
        if (update) {
          updates.push({ values: update, filters: seen });
          return resolve({ data: null, error: null });
        }
        let found = rowsOf().filter((r) => filters.every((f) => f(r)));
        if (range) found = found.slice(range[0], range[1] + 1);
        return resolve({ data: found, error: null });
      },
    };
    tables.push(table);
    return b;
  };
  const readDb = {
    from: (table: string) =>
      builder(table, () => (table === "bank_accounts" ? accounts : table === "statement_lines" ? (opts.lines ?? []) : [{ id: "open-draft", user_id: ME, file_sha256: SHA, status: "draft" }])),
  };
  const admin = {
    from: (table: string) => builder(table, () => []),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "start_statement_csv_import") return opts.startError ? { data: null, error: opts.startError } : { data: "imp-1", error: null };
      return { data: (args.p_lines as unknown[] | undefined)?.length ?? 1, error: null };
    },
  };
  const deps = {
    read: readDb as never,
    admin: admin as never,
    matchLines: async () => 3,
    allowlist: opts.allowlist === undefined ? ME : opts.allowlist,
  };
  return { deps, calls, updates, tables };
}

const send = (rows: unknown[], mode: "preview" | "apply" = "preview", extra: Row = {}) => ({
  mode,
  account_id: BANK,
  file_sha256: SHA,
  layout: "signed",
  convention: "bank",
  rows,
  ...extra,
});

test("allowlist: a user who is not on STATEMENT_IMPORT_USER_IDS gets nothing (404, like every statement route) and nothing is read or written", async () => {
  const { deps, calls, tables } = makeDeps({ allowlist: OTHER });
  const r = await handleStatementCsv(deps, ME, send([row()]), NOW);
  assert.equal(r.status, 404);
  assert.deepEqual([calls.length, tables.length], [0, 0]);
  assert.equal((await handleStatementCsv(makeDeps({ allowlist: "" }).deps, ME, send([row()]), NOW)).status, 404);
  assert.equal((await handleStatementCsv(makeDeps({ allowlist: null }).deps, ME, send([row()]), NOW)).status, 404);
  assert.equal(isStatementImportEnabled(ME, ME.toUpperCase()), true, "the list is case-insensitive and has no wildcard");
  assert.equal(isStatementImportEnabled(ME, "*"), false);
  assert.equal((await handleStatementCsv(makeDeps().deps, ME, send([row()]), NOW)).status, 200);
});

test("allowlist: the route is behind requireStatementUser and the buttons live on the allowlist-only Statements page", () => {
  assert.match(read("../app/api/statements/csv/route.ts"), /requireStatementUser\(\)/);
  assert.doesNotMatch(read("../components/dashboard/expenses-body.tsx"), /Statement(Csv|Import)Button/, "moved off the Expenses toolbar");
  const page = read("../app/(app)/dashboard/expenses/statements/page.tsx");
  assert.match(page, /if \(!ctx\) notFound\(\)/);
  assert.match(page, /<StatementImportButton \/>[\s\S]*<StatementCsvButton \/>[\s\S]*<StatementsList/);
});

test("another user's account id, an unknown id and a removed account are refused, in preview and in apply, with nothing written", async () => {
  for (const mode of ["preview", "apply"] as const) {
    for (const account_id of [THEIRS, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", GONE, "not-a-uuid", 7]) {
      const { deps, calls } = makeDeps();
      const r = await handleStatementCsv(deps, ME, send([row()], mode, { account_id }), NOW);
      assert.equal(r.status, 400, `${mode} ${String(account_id)}`);
      assert.equal(r.body.code, "ACCOUNT_NOT_FOUND");
      assert.equal(calls.length, 0);
    }
  }
});

test("limits: more than 2,000 rows, no rows, a bad layout/convention/fingerprint/period/balance are 400s", async () => {
  assert.equal(STATEMENT_CSV_MAX_ROWS, 2000);
  const { deps } = makeDeps();
  const many = Array.from({ length: 2001 }, (_, i) => row({ row: i + 2 }));
  const tooMany = await handleStatementCsv(deps, ME, send(many), NOW);
  assert.deepEqual([tooMany.status, tooMany.body.code], [400, "TOO_MANY_ROWS"]);
  assert.match(String(tooMany.body.error), /at most 2,000 rows/);
  assert.equal((await handleStatementCsv(deps, ME, send(many.slice(0, 2000)), NOW)).status, 200);
  for (const bad of [
    send([]),
    send([row()], "preview", { layout: "weird" }),
    send([row()], "preview", { convention: "weird" }),
    send([row()], "preview", { file_sha256: "xyz" }),
    send([row()], "preview", { period_start: "2026-02-30" }),
    send([row()], "preview", { period_start: "2026-03-31", period_end: "2026-03-01" }),
    send([row()], "preview", { opening_balance: "lots" }),
    { ...send([row()]), mode: "explode" },
  ]) {
    assert.equal((await handleStatementCsv(deps, ME, bad, NOW)).status, 400);
  }
  assert.equal((await handleStatementCsv(deps, ME, null, NOW)).status, 400);
});

test("preview: nothing is written; the plan, the money out / in totals and the balance warning come back", async () => {
  const { deps, calls, updates } = makeDeps();
  const rows = [row({ amount: -100.1 }), row({ row: 3, amount: -50.2, description: "Beta" }), row({ row: 4, amount: 400, description: "Payroll" })];
  const r = await handleStatementCsv(deps, ME, send(rows, "preview", { opening_balance: 1000, closing_balance: 1250 }), NOW);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.totals, { out: 150.3, outCount: 2, in: 400, inCount: 1 });
  assert.deepEqual(r.body.balance, { state: "off", expected: 1249.7, diff: 0.3 });
  assert.deepEqual([calls.length, updates.length], [0, 0]);
  const ok = await handleStatementCsv(deps, ME, send(rows, "preview", { opening_balance: 1000, closing_balance: 1249.7 }), NOW);
  assert.deepEqual(ok.body.balance, { state: "ok", expected: 1249.7 });
});

test("duplicates: a line already in a saved statement for this account is flagged; the nth identical line is not", async () => {
  const line = (n: number) => ({
    line_fingerprint: lineFingerprint(BANK, "2026-03-14", 12.5, n),
    user_id: ME,
    account_id: BANK,
    committed: true,
    resolution: "new_expense",
    txn_date: "2026-03-14",
  });
  const same = { description: "Acme Supply", amount: -12.5, date: "2026-03-14" };
  // one saved line (n = 1): the first identical line in the file is a duplicate, the second is a new one
  const one = makeDeps({ lines: [line(1)] });
  const r1 = await handleStatementCsv(one.deps, ME, send([row(same), row({ ...same, row: 3 })]), NOW);
  assert.deepEqual((r1.body.rows as { status: string }[]).map((x) => x.status), ["duplicate", "ready"]);
  // both already saved
  const both = makeDeps({ lines: [line(1), line(2)] });
  const r2 = await handleStatementCsv(both.deps, ME, send([row(same), row({ ...same, row: 3 })]), NOW);
  assert.deepEqual((r2.body.rows as { status: string }[]).map((x) => x.status), ["duplicate", "duplicate"]);
  // another account's saved line, an uncommitted one, a skipped one, or another user's: none count
  const other = makeDeps({
    lines: [{ ...line(1), account_id: CARD }, { ...line(1), committed: false }, { ...line(1), resolution: "skipped" }, { ...line(1), user_id: OTHER }],
  });
  const r3 = await handleStatementCsv(other.deps, ME, send([row(same)]), NOW);
  assert.deepEqual((r3.body.rows as { status: string }[]).map((x) => x.status), ["ready"]);
});

test("duplicates: a CSV line matches the same line read from a PDF (account, date, amount - never the description or kind)", async () => {
  const fromPdf = { line_fingerprint: lineFingerprint(CARD, "2026-03-14", 12.5, 1), user_id: ME, account_id: CARD, committed: true, resolution: "matched", txn_date: "2026-03-14" };
  const { deps } = makeDeps({ lines: [fromPdf] });
  const r = await handleStatementCsv(
    deps,
    ME,
    send([row({ description: "ACME SUPPLY #44 TORONTO ON", amount: 12.5 })], "preview", { account_id: CARD, convention: "card" }),
    NOW,
  );
  assert.equal((r.body.rows as { status: string }[])[0].status, "duplicate");
});

test("apply: start, save, finalize in that order with money-out-positive lines, the period and the balances; no unticked total row", async () => {
  const { deps, calls } = makeDeps();
  const rows = [
    row({ amount: -100, description: "Acme" }),
    row({ row: 3, amount: 2000, description: "Payroll" }),
    row({ row: 4, date: "", description: "Total", amount: -1900 }),
  ];
  const r = await handleStatementCsv(
    deps,
    ME,
    send(rows, "apply", { period_start: "2026-03-01", period_end: "2026-03-31", opening_balance: 1000, closing_balance: 2900 }),
    NOW,
  );
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.import_id, "imp-1");
  assert.equal(r.body.href, "/dashboard/expenses/statements/imp-1");
  assert.deepEqual(calls.map((c) => c.fn), ["start_statement_csv_import", "save_chunk_result", "finalize_statement_lines"]);
  assert.deepEqual(calls[0].args, { p_user_id: ME, p_account_id: BANK, p_file_sha256: SHA });
  const save = calls[1].args as { p_lines: Row[]; p_header: Row; p_input_tokens: number; p_import_id: string; p_chunk_no: number };
  assert.deepEqual([save.p_import_id, save.p_chunk_no, save.p_input_tokens], ["imp-1", 1, 0]);
  assert.deepEqual(save.p_lines.map((l) => [l.line_no, l.txn_date, l.amount, l.kind, l.page]), [
    [1, "2026-03-14", 100, "purchase", 1],
    [2, "2026-03-14", -2000, "payment", 1],
  ]);
  assert.deepEqual(save.p_header, { period_start: "2026-03-01", period_end: "2026-03-31", opening_balance: -1000, closing_balance: -2900 });
  assert.doesNotMatch(JSON.stringify(save.p_lines), /Total/, "an unticked total row is not a line");
});

test("apply: a ticked duplicate becomes Import anyway, an unticked plain row is skipped, and a ticked total row is kept", async () => {
  const dupLine = { line_fingerprint: lineFingerprint(BANK, "2026-03-14", 12.5, 1), user_id: ME, account_id: BANK, committed: true, resolution: "new_expense", txn_date: "2026-03-14" };
  const { deps, calls, updates } = makeDeps({ lines: [dupLine] });
  const rows = [
    row({ row: 2, amount: -12.5, import_anyway: true }), // line 1: the duplicate, ticked
    row({ row: 3, amount: -20, description: "Beta", skip: true }), // line 2: unticked
    row({ row: 4, amount: -30, description: "Gamma" }), // line 3: plain
    row({ row: 5, amount: -62.5, description: "Total", import_anyway: true }), // line 4: a total row, ticked
  ];
  const r = await handleStatementCsv(deps, ME, send(rows, "apply"), NOW);
  assert.equal(r.status, 200);
  assert.equal(r.body.choices_applied, true);
  assert.equal(r.body.auto_matched, 3);
  const lines = (calls[1].args as { p_lines: Row[] }).p_lines;
  assert.equal(lines.length, 4);
  assert.deepEqual(
    updates.map((u) => [u.values, u.filters.line_no, u.filters.import_id, u.filters.user_id]),
    [
      [{ duplicate_override: true, resolution: null }, [1], "imp-1", ME],
      [{ resolution: "skipped" }, [2], "imp-1", ME],
    ],
  );
});

test("apply: the same file already saved is refused with its code; an unfinished earlier draft is reused, not doubled", async () => {
  const already = makeDeps({ startError: { message: "ALREADY_IMPORTED" } });
  const r = await handleStatementCsv(already.deps, ME, send([row()], "apply"), NOW);
  assert.deepEqual([r.status, r.body.code, r.body.statements_href], [409, "ALREADY_IMPORTED", "/dashboard/expenses/statements"]);

  const notFound = makeDeps({ startError: { message: "ACCOUNT_NOT_FOUND" } });
  assert.equal((await handleStatementCsv(notFound.deps, ME, send([row()], "apply"), NOW)).status, 400);

  const resumed = makeDeps({ startError: { code: "23505" } });
  const again = await handleStatementCsv(resumed.deps, ME, send([row()], "apply"), NOW);
  assert.equal(again.status, 200);
  assert.equal(resumed.calls.at(-1)?.fn, "finalize_statement_lines");
  assert.equal((resumed.calls[1].args as { p_import_id: string }).p_import_id, "open-draft");
});

test("apply with nothing to import (every row an error) is a 400 and writes nothing", async () => {
  const { deps, calls } = makeDeps();
  const r = await handleStatementCsv(deps, ME, send([row({ amount: null })], "apply"), NOW);
  assert.equal(r.status, 400);
  assert.equal(calls.length, 0);
});

// ---- privacy and the migration ---------------------------------------------------------------------

test("no statement content reaches a log, Sentry or analytics: the new files never log", () => {
  for (const file of ["./statement-csv.ts", "./statement-csv-server.ts", "../app/api/statements/csv/route.ts", "../components/dashboard/statement-csv-button.tsx"]) {
    assert.doesNotMatch(read(file), /console\.|logTiming|Sentry|captureException|posthog|analytics/i, file);
  }
});

test("the migration adds only the CSV starter, to service_role only, and its rollback drops only that", () => {
  const up = read("../../supabase/migrations/0075_statement_csv_import.sql");
  assert.match(up, /create function public\.start_statement_csv_import\(/);
  assert.match(up, /grant execute on function public\.start_statement_csv_import\(uuid, uuid, text\) to service_role/);
  assert.doesNotMatch(up.replace(/--.*$/gm, ""), /start_statement_import\(|alter table|create table|drop /i, "the PDF starter and the tables are untouched");
  const down = read("../../supabase/rollbacks/0075_statement_csv_import_rollback.sql");
  assert.match(down, /drop function if exists public\.start_statement_csv_import\(uuid, uuid, text\)/);
});

test("labels and the review's page label: CSV imports hide 'page N', PDF/photo imports keep it", () => {
  assert.equal(importCameFromCsv({ input_tokens: 0, output_tokens: 0 }), true);
  assert.equal(importCameFromCsv({ input_tokens: 2882, output_tokens: 410 }), false);
  assert.match(read("../components/dashboard/statement-review-line.tsx"), /showPage = true/);
  assert.match(read("../components/dashboard/statement-review.tsx"), /showPage=\{!data\.import\.from_csv\}/);
  assert.match(read("../components/dashboard/expenses-body.tsx"), /Import expenses \(CSV\)/);
  assert.match(read("../components/dashboard/statement-csv-button.tsx"), /Import statement \(CSV\)/);
  assert.match(read("../components/dashboard/statement-import-button.tsx"), /Import statement \(PDF\/photo\)/);
  assert.match(read("../components/dashboard/import-expenses-dialog.tsx"), /Import expenses from CSV/);
  assert.match(read("../components/dashboard/statement-csv-button.tsx"), /Import a statement from CSV/);
});
