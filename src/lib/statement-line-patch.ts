import type { StatementLineKind } from "./database.types.ts";
import {
  dayNumber,
  isIsoDate,
  LINE_KINDS,
  maskCardNumbers,
  round2,
} from "./statement-lines.ts";
import { resolveStatementCategory } from "./statement-categories.ts";

// Turns one review-screen edit into a validated database update for one line.
// All the rules the constraints in 0052 enforce are checked here first so the
// user gets a plain-English reason instead of a database error, and so the rules
// (refund sign, HST only on refunds, who can be matched) are unit-tested.

export interface LineState {
  kind: StatementLineKind;
  amount: number;
  txn_date: string;
  resolution: "matched" | "new_expense" | "skipped" | null;
  suggested_category: string | null;
  duplicate_of_line_id: string | null;
  duplicate_override: boolean;
  tax_amount: number;
}

export interface LinePatch {
  resolution?: "matched" | "new_expense" | "skipped" | null;
  matched_receipt_id?: string | null;
  category?: string;
  /** Take the model's suggested category as the confirmed one. */
  accept_suggestion?: boolean;
  paid_with_account_id?: string | null;
  /** A refund's HST as a positive number ("HST refunded"); stored as a credit. */
  tax_amount?: number;
  duplicate_override?: boolean;
  description?: string;
  txn_date?: string;
  amount?: number;
  kind?: StatementLineKind;
}

export type LineUpdate = Partial<{
  resolution: "matched" | "new_expense" | "skipped" | null;
  matched_receipt_id: string | null;
  category: string | null;
  category_confirmed: boolean;
  paid_with_account_id: string | null;
  tax_amount: number;
  duplicate_override: boolean;
  description: string;
  txn_date: string;
  amount: number;
  kind: StatementLineKind;
}>;

export type PatchOutcome =
  | {
      ok: true;
      update: LineUpdate;
      /** The date or amount changed: fingerprints/duplicate flags must be recomputed. */
      refingerprint: boolean;
      /** A receipt the caller must verify (owned, a real candidate) before writing. */
      checkReceiptId: string | null;
      /** An account id the caller must verify is the owner's. */
      checkAccountId: string | null;
    }
  // Nothing to do for this line (e.g. accepting a suggestion that doesn't exist).
  | { ok: true; skip: true; reason: string }
  | { ok: false; error: string };

const fail = (error: string): PatchOutcome => ({ ok: false, error });

export function buildLineUpdate(
  line: LineState,
  patch: LinePatch,
  categoryOptions: string[],
  today: string,
): PatchOutcome {
  const update: LineUpdate = {};

  // --- effective values after the edit, used to check the combination --------
  let kind = line.kind;
  let amount = line.amount;

  if (patch.kind !== undefined) {
    if (!LINE_KINDS.includes(patch.kind)) return fail("Unknown line type.");
    kind = patch.kind;
    update.kind = kind;
  }
  if (patch.amount !== undefined) {
    if (typeof patch.amount !== "number" || !Number.isFinite(patch.amount) || patch.amount === 0) {
      return fail("Enter an amount other than 0.");
    }
    amount = round2(patch.amount);
    update.amount = amount;
  }
  if (kind === "refund" && amount >= 0) {
    return fail("A refund must be a negative amount.");
  }

  if (patch.txn_date !== undefined) {
    if (!isIsoDate(patch.txn_date) || dayNumber(patch.txn_date) > dayNumber(today) + 1 || patch.txn_date < "2000-01-01") {
      return fail("Enter a valid date that isn't in the future.");
    }
    update.txn_date = patch.txn_date;
  }
  if (patch.description !== undefined) {
    const d = maskCardNumbers(String(patch.description).replace(/\s+/g, " ").trim()).slice(0, 200);
    if (!d) return fail("A line needs a description.");
    update.description = d;
  }

  // --- resolution ----------------------------------------------------------
  let resolution = line.resolution;
  if (patch.resolution !== undefined) resolution = patch.resolution;
  if (patch.matched_receipt_id) resolution = "matched";

  // A kind change can take a line out of what it was resolved as.
  if (patch.kind !== undefined && patch.kind !== line.kind) {
    if (kind === "payment") resolution = "skipped";
    else if (resolution === "matched" && !(amount > 0 && (kind === "purchase" || kind === "other"))) resolution = null;
  }
  if (patch.amount !== undefined && resolution === "matched" && amount <= 0) resolution = null;

  let checkReceiptId: string | null = null;
  if (resolution === "matched") {
    if (!(amount > 0 && (kind === "purchase" || kind === "other"))) {
      return fail("Only a purchase can be matched to a receipt.");
    }
    if (patch.matched_receipt_id) {
      checkReceiptId = patch.matched_receipt_id;
      update.matched_receipt_id = patch.matched_receipt_id;
    } else if (patch.resolution === "matched") {
      return fail("Choose which receipt to match.");
    }
  } else if (patch.resolution !== undefined || patch.kind !== undefined || patch.amount !== undefined) {
    // Leaving 'matched' (or never having been) always clears the claim.
    update.matched_receipt_id = null;
  }
  if (resolution === "new_expense" && kind === "payment") {
    return fail("A payment to the card isn't an expense. Change the type first if this was misread.");
  }

  // --- duplicates -----------------------------------------------------------
  if (patch.duplicate_override !== undefined) {
    if (patch.duplicate_override && !line.duplicate_of_line_id) {
      return fail("This line isn't a duplicate, so there's nothing to override.");
    }
    update.duplicate_override = patch.duplicate_override;
    if (patch.duplicate_override === false) {
      // Back to "Already imported", skipped.
      resolution = "skipped";
      update.matched_receipt_id = null;
    } else if (patch.resolution === undefined && line.resolution === "skipped") {
      // "Import anyway" with no explicit choice: make the user choose what to do.
      resolution = null;
    }
  }

  // --- category ---------------------------------------------------------------
  if (patch.category !== undefined && patch.accept_suggestion) {
    return fail("Choose a category or accept the suggestion, not both.");
  }
  if (patch.category !== undefined) {
    const canonical = resolveStatementCategory(patch.category, categoryOptions);
    if (!canonical) return fail("That category isn't one of yours.");
    update.category = canonical;
    update.category_confirmed = true;
  } else if (patch.accept_suggestion) {
    if (!line.suggested_category) return { ok: true, skip: true, reason: "no suggestion" };
    const canonical = resolveStatementCategory(line.suggested_category, categoryOptions);
    if (!canonical) return { ok: true, skip: true, reason: "suggestion no longer available" };
    update.category = canonical;
    update.category_confirmed = true;
  }
  // Choosing or accepting a category is what includes a line as an expense.
  if (
    (update.category_confirmed === true) &&
    resolution === null &&
    kind !== "payment" &&
    patch.resolution === undefined
  ) {
    resolution = "new_expense";
  }

  // --- paid with ---------------------------------------------------------------
  let checkAccountId: string | null = null;
  if (patch.paid_with_account_id !== undefined) {
    update.paid_with_account_id = patch.paid_with_account_id || null;
    checkAccountId = patch.paid_with_account_id || null;
  }

  // --- HST: only ever on a refund, only ever typed by the user ------------------
  if (patch.tax_amount !== undefined) {
    if (kind !== "refund") {
      return fail("HST can only be entered on a refund. Purchases saved without a receipt never get an HST estimate.");
    }
    const entered = Math.abs(Number(patch.tax_amount));
    if (!Number.isFinite(entered)) return fail("Enter the HST as a number.");
    if (entered > Math.abs(amount)) return fail("The HST can't be more than the refund itself.");
    update.tax_amount = entered === 0 ? 0 : -round2(entered);
  } else if (line.tax_amount !== 0 && (kind !== "refund" || (patch.amount !== undefined && Math.abs(line.tax_amount) > Math.abs(amount)))) {
    // The HST no longer fits this line (type or amount changed).
    update.tax_amount = 0;
  }

  if (resolution !== line.resolution || patch.resolution !== undefined || update.matched_receipt_id !== undefined) {
    update.resolution = resolution;
  }
  if (resolution !== "matched" && update.matched_receipt_id === undefined && line.resolution === "matched") {
    update.matched_receipt_id = null;
  }

  return {
    ok: true,
    update,
    refingerprint: patch.txn_date !== undefined || patch.amount !== undefined,
    checkReceiptId,
    checkAccountId,
  };
}
