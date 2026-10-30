import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import {
  EXPENSE_IMPORT_BATCH,
  EXPENSE_IMPORT_MAX_ROWS,
  coerceImportRow,
  parseDate,
  decideRow,
  planExpenseImport,
  resolveImportCategory,
  type ExistingExpense,
  type ExpenseImportRow,
  type PlannedRow,
} from "./expense-import.ts";
import { loadCategoryRows } from "./statement-bank-charges.ts";
import { FUTURE_DATE_MESSAGE, validateWorkDateForApi } from "./work-date.ts";
import { bankChargesSuggestion, resolveBankCharges } from "./statement-categories.ts";
import { buildCategoryDefaults } from "./tax-codes.ts";

// The server half of "Import CSV" on the Expenses page. The browser parses the file and sends only the
// mapped rows ({ row, date, supplier, invoice_number, category, description, subtotal, tax, total, skip?,
// import_anyway? }); the file itself is never sent or stored. EVERYTHING is decided again here from the
// session's user id and those plain values: row cap, field shapes, the category, the tax math, the
// duplicate rules, which rows save. The client's idea of a row's status is never read.
//
//   preview  {mode:"preview", default_category, rows, fallback_date?}   the plan for every row; nothing is written
//   apply    {mode:"apply",   default_category, rows, fallback_date?}   saves what the plan allows, in batches
//
// `fallback_date` is the dialog's "Date for rows without a date": it dates every row that was sent with an
// empty date. It is sent with BOTH requests and validated here (a real date, not in the future).
//
// Saved rows are ordinary expenses, exactly like a manually typed one: no image, no job (overhead),
// the invoice number kept, tax_category resolved. Nothing here counts as a receipt scan, and nothing
// the person typed is logged or echoed back in an error: failures carry fixed wording and row numbers.
//
// Not wired to the plan caps because there are none for expenses: manual entry is uncapped on every
// plan (the free scan allowance counts scanned images only - see parse-receipt).

type Db = SupabaseClient<Database>;
export interface HandlerResult {
  status: number;
  body: Record<string, unknown>;
}

// The error a database without receipts.import_batch_id gives: PostgREST's "could not find the column" (a
// schema-cache miss) or Postgres's own "column ... does not exist". Both name the column.
function isBatchColumnError(error: { code?: string; message?: string }): boolean {
  return error.code === "PGRST204" || /import_batch_id/i.test(error.message ?? "");
}

const PAGE = 1000;
const MAX_PAGES = 20;
const SAVE_FAILED = "Could not save this row";

// Existing expenses the duplicate rules compare against: every one that has an invoice number (the
// number rule ignores dates), plus everything dated inside the file's own date range (the "same
// supplier, date and total" rule). Paged: the API returns at most 1000 rows per request.
async function loadExisting(db: Db, userId: string, dates: string[]): Promise<ExistingExpense[]> {
  const columns = "id, merchant_name, invoice_number, transaction_date, total_amount";
  const sorted = [...dates].sort();
  const scopes: ("numbered" | "range")[] = sorted.length > 0 ? ["numbered", "range"] : ["numbered"];
  const found = new Map<string, ExistingExpense>();
  for (const scope of scopes) {
    for (let page = 0; page < MAX_PAGES; page++) {
      let query = db.from("receipts").select(columns).eq("user_id", userId);
      query =
        scope === "numbered"
          ? query.not("invoice_number", "is", null)
          : query.gte("transaction_date", sorted[0]).lte("transaction_date", sorted[sorted.length - 1]);
      const { data, error } = await query.order("id").range(page * PAGE, (page + 1) * PAGE - 1);
      if (error) throw new Error("load-existing");
      for (const r of data ?? []) {
        found.set(r.id, {
          merchant_name: r.merchant_name,
          invoice_number: r.invoice_number ?? null,
          transaction_date: r.transaction_date,
          total_amount: Number(r.total_amount),
        });
      }
      if ((data?.length ?? 0) < PAGE) break;
    }
  }
  return [...found.values()];
}

// The rows after the same plan the preview showed, plus what to do with each.
export async function planRequest(
  db: Db,
  userId: string,
  body: Record<string, unknown>,
  fallbackDate: string | null = null,
): Promise<{ inputs: ExpenseImportRow[]; planned: PlannedRow[]; defaultCategory: string } | HandlerResult> {
  const rawRows = body.rows;
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    return { status: 400, body: { error: "There are no rows to import." } };
  }
  if (rawRows.length > EXPENSE_IMPORT_MAX_ROWS) {
    return {
      status: 400,
      body: { error: `An import can have at most ${EXPENSE_IMPORT_MAX_ROWS} rows. Split it into smaller files.` },
    };
  }
  const inputs = rawRows.map(coerceImportRow);

  const categoryRows = await loadCategoryRows(db, userId);
  const customCategories = categoryRows.map((c) => c.name);
  const defaultCategory = resolveImportCategory(
    typeof body.default_category === "string" ? body.default_category : "",
    "Other",
    customCategories,
  ).category;
  const defaults = buildCategoryDefaults({
    bankChargesName: bankChargesSuggestion(resolveBankCharges(categoryRows)),
  });

  // The dates the rows will have: their own, plus the picker's for the undated ones (so saved expenses on
  // that date are loaded for the "same supplier, date and total" warning).
  const existing = await loadExisting(
    db,
    userId,
    [...inputs.map((r) => r.date), ...(fallbackDate ? [fallbackDate] : [])].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
  );
  const planned = planExpenseImport(inputs, { defaultCategory, customCategories, existing, defaults, fallbackDate });
  return { inputs, planned, defaultCategory };
}

// "Date for rows without a date": optional, and validated here whatever the dialog checked. A real calendar
// date, not before 2000, and not in the future (the same rule and the same one-day timezone allowance as
// other typed dates: see validateWorkDateForApi). Blank/absent = no fallback. Returns the date, null for
// none, or an error result.
function readFallbackDate(value: unknown, now: Date): { date: string | null } | HandlerResult {
  if (value === undefined || value === null || value === "") return { date: null };
  const error = validateWorkDateForApi(value, now);
  if (error === FUTURE_DATE_MESSAGE) {
    return { status: 400, body: { error: "The date for rows without a date can't be in the future." } };
  }
  if (error !== null || typeof value !== "string" || parseDate(value, null) !== value) {
    return { status: 400, body: { error: "The date for rows without a date isn't a valid date." } };
  }
  return { date: value };
}

const isResult = (v: unknown): v is HandlerResult => typeof v === "object" && v !== null && "status" in v && "body" in v;

export async function handleExpenseImport(
  db: Db,
  userId: string,
  body: unknown,
  now: Date = new Date(),
): Promise<HandlerResult> {
  if (typeof body !== "object" || body === null) return { status: 400, body: { error: "Could not read the request." } };
  const b = body as Record<string, unknown>;
  if (b.mode !== "preview" && b.mode !== "apply") return { status: 400, body: { error: "Unknown request." } };

  const fallback = readFallbackDate(b.fallback_date, now);
  if (isResult(fallback)) return fallback;

  let plan: Awaited<ReturnType<typeof planRequest>>;
  try {
    plan = await planRequest(db, userId, b, fallback.date);
  } catch {
    return { status: 500, body: { error: "Could not check the import. Please try again." } };
  }
  if (isResult(plan)) return plan;
  const { inputs, planned, defaultCategory } = plan;

  if (b.mode === "preview") {
    return { status: 200, body: { rows: planned, default_category: defaultCategory } };
  }

  // ---- apply
  // One id for this whole import, written on every expense it creates (receipts.import_batch_id, 0074), so
  // the Expenses tab can list the import and delete it as a group. Generated here, never taken from the
  // request.
  const batchId = crypto.randomUUID();
  const toSave: { row: number; values: Database["public"]["Tables"]["receipts"]["Insert"] }[] = [];
  const failed: { row: number; reason: string }[] = [];
  let skipped = 0;
  planned.forEach((p, i) => {
    const decision = decideRow(p, inputs[i]);
    if (decision === "skip") return void (skipped += 1);
    if (decision === "error" || !p.expense) return void failed.push({ row: p.row, reason: p.messages[0] ?? SAVE_FAILED });
    const e = p.expense;
    toSave.push({
      row: p.row,
      values: {
        user_id: userId,
        image_url: null,
        merchant_name: e.merchant_name,
        transaction_date: e.transaction_date,
        total_amount: e.total_amount,
        tax_amount: e.tax_amount,
        tax_category: e.tax_category,
        job_name: null,
        items: e.items,
        import_batch_id: batchId,
        ...(e.invoice_number && { invoice_number: e.invoice_number }),
      },
    });
  });

  // TEMPORARY, until migration 0074 is applied everywhere: if the database has no import_batch_id column the
  // insert is retried without it, so importing keeps working (the import just can't be grouped). Once 0074
  // is live this branch never runs and can be deleted.
  let useBatchColumn = true;
  const valuesFor = (values: (typeof toSave)[number]["values"]) => {
    if (useBatchColumn) return values;
    const { import_batch_id: omitted, ...rest } = values;
    void omitted;
    return rest;
  };

  const createdIds: string[] = [];
  for (let i = 0; i < toSave.length; i += EXPENSE_IMPORT_BATCH) {
    const batch = toSave.slice(i, i + EXPENSE_IMPORT_BATCH);
    let result = await db.from("receipts").insert(batch.map((r) => valuesFor(r.values))).select("id");
    if (result.error && useBatchColumn && isBatchColumnError(result.error)) {
      useBatchColumn = false;
      result = await db.from("receipts").insert(batch.map((r) => valuesFor(r.values))).select("id");
    }
    if (!result.error) {
      createdIds.push(...(result.data ?? []).map((r) => r.id));
      continue;
    }
    // One bad row must not cost the batch: save them one at a time to find it.
    for (const r of batch) {
      const one = await db.from("receipts").insert(valuesFor(r.values)).select("id").single();
      if (one.error || !one.data) failed.push({ row: r.row, reason: SAVE_FAILED });
      else createdIds.push(one.data.id);
    }
  }

  return {
    status: 200,
    body: {
      imported: createdIds.length,
      skipped,
      failed,
      created_ids: createdIds,
      // null when nothing was saved, or the column isn't there yet (the import can't be grouped)
      import_batch_id: useBatchColumn && createdIds.length > 0 ? batchId : null,
    },
  };
}

// Undo right after an import: deletes the expenses that import created. Only this owner's rows, only ids
// that look like uuids, at most the import cap, and only rows with no image (an import never has one), so
// it can never remove a scanned receipt even if a wrong id were sent.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleExpenseImportUndo(db: Db, userId: string, body: unknown): Promise<HandlerResult> {
  const ids = (body as { ids?: unknown } | null)?.ids;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > EXPENSE_IMPORT_MAX_ROWS ||
    !ids.every((id) => typeof id === "string" && UUID.test(id))
  ) {
    return { status: 400, body: { error: "Nothing to undo." } };
  }
  const unique = [...new Set(ids as string[])];
  const { data, error } = await db
    .from("receipts")
    .delete()
    .eq("user_id", userId)
    .in("id", unique)
    .is("image_url", null)
    .select("id");
  if (error) return { status: 500, body: { error: "Could not undo the import. Please try again." } };
  return { status: 200, body: { removed: (data ?? []).length } };
}
