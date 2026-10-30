import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SELECT_ALL_MAX_ROWS, SELECT_ALL_PAGE, TRUNCATED_NOTICE, selectAll, type RangeQuery } from "./select-all.ts";
import { loadOverviewReceipts } from "./overview-rows.ts";
import { computeExpenseSummary } from "./expense-summary.ts";
import { groupSpendingByAccount } from "./account-spending.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

// ---- a stand-in for a Supabase query over N rows ---------------------------------------------------

interface Fake {
  build: () => RangeQuery<{ id: number }>;
  ranges: [number, number][];
  builds: () => number;
}

// `rows` are numbered 0..n-1 in query order. The fake answers at most 1000 rows per request (the API's own
// page), like the real thing, whatever range is asked for.
function fakeRows(n: number, failAtCall: number | null = null): Fake {
  const ranges: [number, number][] = [];
  let builds = 0;
  return {
    ranges,
    builds: () => builds,
    build: () => {
      builds += 1;
      return {
        range: async (from: number, to: number) => {
          ranges.push([from, to]);
          if (failAtCall !== null && ranges.length === failAtCall) {
            return { data: null, error: { message: "boom: page failed" } };
          }
          const end = Math.min(to + 1, from + 1000, n);
          return { data: Array.from({ length: Math.max(end - from, 0) }, (_, i) => ({ id: from + i })), error: null };
        },
      };
    },
  };
}

test("the constants: a page is 1000 (the API's), the ceiling is 20,000", () => {
  assert.equal(SELECT_ALL_PAGE, 1000);
  assert.equal(SELECT_ALL_MAX_ROWS, 20_000);
  assert.match(TRUNCATED_NOTICE, /20,000/);
});

test("empty: no rows, not truncated, one request", async () => {
  const f = fakeRows(0);
  assert.deepEqual(await selectAll(f.build), { rows: [], truncated: false });
  assert.deepEqual(f.ranges, [[0, 999]]);
});

test("a short single page: 999 rows, one request", async () => {
  const f = fakeRows(999);
  const r = await selectAll(f.build);
  assert.equal(r.rows.length, 999);
  assert.equal(r.truncated, false);
  assert.equal(f.ranges.length, 1);
});

test("an exact multiple of 1000: the next page is asked for and comes back empty", async () => {
  for (const n of [1000, 2000, 5000]) {
    const f = fakeRows(n);
    const r = await selectAll(f.build);
    assert.equal(r.rows.length, n, String(n));
    assert.equal(r.truncated, false);
    assert.equal(f.ranges.length, n / 1000 + 1, `${n}: its full pages plus one empty page`);
    assert.deepEqual(f.ranges[f.ranges.length - 1], [n, n + 999]);
  }
});

test("a short last page: 2500 rows are three pages (1000, 1000, 500)", async () => {
  const f = fakeRows(2500);
  const r = await selectAll(f.build);
  assert.equal(r.rows.length, 2500);
  assert.deepEqual(f.ranges, [[0, 999], [1000, 1999], [2000, 2999]]);
  assert.deepEqual(r.rows.map((x) => x.id), Array.from({ length: 2500 }, (_, i) => i), "in order, none repeated, none skipped");
});

test("every page is a freshly built query with its own .range()", async () => {
  const f = fakeRows(3200);
  await selectAll(f.build);
  assert.equal(f.builds(), f.ranges.length);
  assert.equal(f.builds(), 4);
});

test("the ceiling: exactly 20,000 rows is complete (not truncated); the probe row decides", async () => {
  const f = fakeRows(20_000);
  const r = await selectAll(f.build);
  assert.equal(r.rows.length, 20_000);
  assert.equal(r.truncated, false);
  assert.equal(f.ranges.length, 21, "20 full pages and one probe request");
  assert.deepEqual(f.ranges[20], [20_000, 20_000]);
});

test("the ceiling reached with more behind it: the first 20,000 in order, and truncated is true", async () => {
  for (const n of [20_001, 25_000, 60_000]) {
    const f = fakeRows(n);
    const r = await selectAll(f.build);
    assert.equal(r.rows.length, 20_000, String(n));
    assert.equal(r.truncated, true, String(n));
    assert.equal(r.rows[0].id, 0);
    assert.equal(r.rows[19_999].id, 19_999);
    assert.equal(f.ranges.length, 21, "it never reads past the ceiling plus one probe row");
  }
});

test("truncated is never set below the ceiling", async () => {
  for (const n of [0, 1, 999, 1000, 1001, 19_999]) {
    assert.equal((await selectAll(fakeRows(n).build)).truncated, false, String(n));
  }
});

test("errors propagate: a failed page throws, it is not read as 'the rows ran out'", async () => {
  await assert.rejects(selectAll(fakeRows(5000, 1).build), /boom: page failed/);
  await assert.rejects(selectAll(fakeRows(5000, 3).build), /boom: page failed/, "a failure on a later page");
  // the probe at the ceiling can fail too
  await assert.rejects(selectAll(fakeRows(30_000, 21).build), /boom: page failed/);
  // a thrown rejection from the query itself passes through as well
  await assert.rejects(
    selectAll(() => ({ range: () => Promise.reject(new Error("network down")) })),
    /network down/,
  );
});

test("null data with no error is an empty page (a head-style answer), not a crash", async () => {
  const r = await selectAll(() => ({ range: async () => ({ data: null, error: null }) }));
  assert.deepEqual(r, { rows: [], truncated: false });
});

// ---- the order must be stable ---------------------------------------------------------------------------

// Rows whose sort value ties. Without a unique tiebreak the database may return a tie group in a different
// order on every request; the fake does that (a rotating shuffle per request), and with an id tiebreak it
// cannot.
function tiedTable(n: number) {
  const table = Array.from({ length: n }, (_, i) => ({ id: i, date: Math.floor(i / 400) }));
  // ONE counter across every page's query, like the real database seeing request after request
  let request = 0;
  return (orderCols: string[]) => {
    return {
      range: async (from: number, to: number) => {
        request += 1;
        const rows = [...table].sort((a, b) => {
          if (a.date !== b.date) return a.date - b.date;
          if (orderCols.includes("id")) return a.id - b.id;
          // unspecified order within a tie: differs per request
          const key = (id: number) => (Math.imul(id + 1, 2654435761 + request * 40503) >>> 0) % 1000003;
          return key(a.id) - key(b.id);
        });
        return { data: rows.slice(from, Math.min(to + 1, from + 1000)), error: null };
      },
    };
  };
}

test("with an id tiebreak every row comes back exactly once; without one, pages repeat and skip rows", async () => {
  const query = tiedTable(2600);
  const stable = await selectAll(() => query(["date", "id"]));
  assert.equal(stable.rows.length, 2600);
  assert.equal(new Set(stable.rows.map((r) => r.id)).size, 2600, "no row twice, none missing");

  const unstable = await selectAll(() => query(["date"]));
  assert.equal(unstable.rows.length, 2600, "the count looks right...");
  assert.ok(new Set(unstable.rows.map((r) => r.id)).size < 2600, "...but rows are repeated and others never seen");
});

// ---- the loaders: none left without it ----------------------------------------------------------------

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

// Every unbounded read of these tables in the listed files must be inside selectAll(...). A read that is a
// head count, a single row, a write, or an `.in("id", ...)` slice of at most a hundred ids is not unbounded.
const BIG_TABLES = /\.from\("(receipts|documents|hour_entries|statement_lines)"\)/g;
const LOADERS = [
  "../app/(app)/dashboard/expenses/page.tsx",
  "../app/(app)/dashboard/page.tsx",
  "../app/(app)/dashboard/jobs/page.tsx",
  "../app/(app)/dashboard/jobs/[id]/page.tsx",
  "../app/api/documents/route.ts",
  "../app/api/accountant-portal/export-data/route.ts",
  "./accountant-portal-server.ts",
  "./accountant-export.ts",
  "./expense-overview-query.ts",
  "./overview-rows.ts",
  "./reports-query.ts",
  "./statement-match-server.ts",
  "./statement-groups-server.ts",
];

test("no unbounded read in the listed loaders is left without selectAll, and each one has a stable (id-ended) order", () => {
  let checked = 0;
  for (const file of LOADERS) {
    const src = stripComments(read(file));
    let m: RegExpExecArray | null;
    BIG_TABLES.lastIndex = 0;
    while ((m = BIG_TABLES.exec(src))) {
      const statement = src.slice(m.index, m.index + 700).split(";")[0];
      if (/\.(single|maybeSingle|delete|update|insert|upsert)\(|\.limit\(1\)|head: true|\.in\("id"|\.eq\("id"/.test(statement)) continue;
      if (src.slice(Math.max(0, m.index - 40), m.index).trimEnd().endsWith("storage")) continue; // the file bucket, not a table
      const before = src.slice(0, m.index);
      const open = before.lastIndexOf("selectAll(");
      assert.ok(open >= 0 && !before.slice(open).includes(";"), `${file}: ${m[0]} at ${m.index} is not inside selectAll(...)`);
      // the whole selectAll(...) call it sits in (matching parentheses), and its order ends with the id tiebreak
      let depth = 0;
      let close = open + "selectAll".length;
      for (; close < src.length; close++) {
        if (src[close] === "(") depth += 1;
        else if (src[close] === ")" && --depth === 0) break;
      }
      assert.match(src.slice(open, close + 1), /\.order\("id"/, `${file}: ${m[0]} has no id tiebreak in its order`);
      checked += 1;
    }
  }
  assert.ok(checked >= 20, `expected to check the listed queries, checked ${checked}`);
});

test("the old row limits are gone from the statement loaders", () => {
  assert.doesNotMatch(stripComments(read("./statement-match-server.ts")), /\.limit\(5000\)/);
  assert.doesNotMatch(stripComments(read("./statement-groups-server.ts")), /\.limit\(1000\)/);
  assert.match(read("./statement-match-server.ts"), /selectAll\(\(\) =>/);
  assert.match(read("./statement-groups-server.ts"), /selectAll\(\(\) =>/);
});

test("the Overview's order is now the date plus id", () => {
  const src = read("./overview-rows.ts");
  assert.match(src, /\.order\("transaction_date", \{ ascending: true \}\)\.order\("id", \{ ascending: true \}\)/);
});

test("the accountant portal export puts the date range INTO the query (the list is not filtered afterwards)", () => {
  const route = stripComments(read("../app/api/accountant-portal/export-data/route.ts"));
  assert.match(route, /loadAccountantExpenses\(db, \{ from, to \}\)/);
  assert.doesNotMatch(route, /allReceipts|\.filter\(\s*\(r\) =>/, "no load-then-filter in code");
  const portal = stripComments(read("./accountant-portal-server.ts"));
  const loader = portal.slice(portal.indexOf("export async function loadAccountantExpenses"), portal.indexOf("export async function listAccountantExpenses"));
  assert.match(loader, /query\.gte\("transaction_date", range\.from\)/);
  assert.match(loader, /query\.lte\("transaction_date", range\.to\)/);
});

// ---- Overview and Reports are built from the same rows ---------------------------------------------------

test("Reports and the Job Summary load the range's expenses ONCE and hand the same rows to the overview totals", () => {
  const reports = stripComments(read("./reports-query.ts"));
  const fn = (name: string, next: string) => reports.slice(reports.indexOf(`export async function ${name}`), reports.indexOf(next));
  const reportsData = fn("getReportsData", "function categoryKey");
  const jobSummary = fn("getJobSummary", "export interface RevenueDetailRow");
  for (const body of [reportsData, jobSummary]) {
    assert.equal((body.match(/loadOverviewReceipts\(/g) ?? []).length, 1, "one load");
    assert.match(body, /getExpenseOverviewData\(supabase, from, to, loaded\)/, "the overview gets those rows");
    assert.doesNotMatch(body, /\.from\("receipts"\)/, "no second, separate expenses query");
  }
  assert.match(reportsData, /groupSpendingByAccount\(\s*loaded\.rows/, "the By Account table is built from them too");
  assert.match(jobSummary, /const receipts = loaded\.rows;/);
  const overview = stripComments(read("./expense-overview-query.ts"));
  assert.match(overview, /loaded \?\? \(await loadOverviewReceipts\(supabase, from, to\)\)/);
});

test("over 1000 rows, the P&L's expenses and the By Account total are one number: every row, from one load", async () => {
  // 2,600 expenses in the range, two accounts. Both views are computed from the rows loadOverviewReceipts
  // returns (the very rows getReportsData passes to both); the old per-view queries each stopped at 1000.
  const n = 2600;
  const table = Array.from({ length: n }, (_, i) => ({
    transaction_date: `2026-0${1 + (i % 9)}-15`,
    total_amount: 10 + (i % 17),
    tax_amount: 1,
    tax_category: "Materials & Supplies",
    job_id: i % 5 === 0 ? "job" : null,
    paid_with_account_id: i % 2 === 0 ? "acc-a" : null,
    id: i,
  }));
  const db = {
    from: () => {
      const b = {
        select: () => b,
        gte: () => b,
        lte: () => b,
        order: () => b,
        range: async (a: number, z: number) => ({ data: table.slice(a, Math.min(z + 1, a + 1000)), error: null }),
      };
      return b;
    },
  } as unknown as Parameters<typeof loadOverviewReceipts>[0];

  const loaded = await loadOverviewReceipts(db, "2026-01-01", "2026-12-31");
  assert.equal(loaded.rows.length, n);
  assert.equal(loaded.truncated, false);

  const expected = table.reduce((s, r) => s + r.total_amount, 0);
  const overview = computeExpenseSummary(loaded.rows.map((r) => ({ ...r, tax_category: r.tax_category })));
  const accounts = groupSpendingByAccount(
    loaded.rows.map((r) => ({ total_amount: r.total_amount, tax_amount: r.tax_amount, tax_category: r.tax_category, paid_with_account_id: r.paid_with_account_id ?? null })),
    [{ id: "acc-a", name: "Card A", account_type: "card", is_active: true }],
  );
  assert.equal(overview.totalExpenses, expected);
  assert.equal(accounts.total, expected, "the By Account total ties to the P&L's expenses");
  assert.ok(expected > table.slice(0, 1000).reduce((s, r) => s + r.total_amount, 0), "more than the first 1000 rows are counted");
});

// ---- the notices -----------------------------------------------------------------------------------------

test("a truncated load shows 'Some totals may be incomplete' on the HST card, the Overview and the Expenses summary", () => {
  assert.match(read("../components/dashboard/truncation-notice.tsx"), /Some totals may be incomplete/);
  const hst = read("../components/dashboard/hst-summary-card.tsx");
  assert.match(hst, /receiptsTruncated \|\| invoicesTruncated/);
  assert.match(hst, /<TruncationNotice \/>/);
  assert.match(hst, /data\.truncated === true/, "the invoice list the card fetches can flag it too");
  assert.match(read("../components/dashboard/expense-overview.tsx"), /<TruncationNotice show=\{data\.truncated\} \/>/);
  const summary = read("../components/dashboard/receipts-summary.tsx");
  assert.match(summary, /<TruncationNotice show=\{truncated\} \/>/);
  // the pages pass the flag on
  assert.match(read("../components/dashboard/expenses-body.tsx"), /truncated=\{receiptsTruncated\}/);
  const dash = read("../components/dashboard/dashboard-body.tsx");
  assert.match(dash, /truncated=\{receiptsTruncated\}/);
  assert.match(dash, /receiptsTruncated=\{receiptsTruncated\}/);
  assert.match(read("../app/(app)/dashboard/expenses/page.tsx"), /receiptsTruncated=\{receiptsTruncated\}/);
  assert.match(read("../app/(app)/dashboard/page.tsx"), /receiptsTruncated=\{receiptsTruncated\}/);
  assert.match(read("../app/api/documents/route.ts"), /documents: rows, truncated/);
});
