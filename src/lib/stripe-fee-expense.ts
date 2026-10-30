import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import { formatDocumentNumber } from "./document-number.ts";
import { round2 } from "./payments.ts";
import { BANK_CHARGES_CATEGORY } from "./tax-categories.ts";
import { ensureBankChargesCategory } from "./statement-bank-charges.ts";

type Admin = SupabaseClient<Database>;

// Stripe's processing fee and dispute fee, recorded as an ordinary expense the moment they are known.
// Owner's accountant: a Stripe fee carries no HST, so the expense has tax 0 (no input tax credit) and
// no tax code. It is filed under "Bank Charges & Interest" (a built-in category; an owner who renamed
// their own keyed "Bank charges" row keeps that name, as in the statement import) - or "Other" if the
// owner removed that custom row, which is respected.
//
// Created at most ONCE per payment / dispute, by `record_stripe_fee_expense()` (migration 0071), which
// locks the payment / dispute row, inserts the expense and stores `fee_expense_outcome` in one
// transaction. The stored outcome is never cleared, so deleting the expense does not let a webhook
// retry bring it back. A refund creates nothing: Stripe keeps its fee on a refund.
//
// Nothing here is a Stripe call; the amount is the fee already stored from Stripe's own data.

export const STRIPE_FEE_MERCHANT = "Stripe";
export const FALLBACK_FEE_CATEGORY = "Other";

export type FeeSource = { kind: "payment"; id: string } | { kind: "dispute"; id: string };

export interface FeeExpenseInput {
  userId: string;
  source: FeeSource;
  /** Stripe's fee in dollars, from stored Stripe data. null / 0 = nothing to record. */
  fee: number | null;
  /** The expense date (YYYY-MM-DD): the payment date, or the date the dispute was received. */
  date: string;
  documentNumber: number;
}

export type FeeExpenseResult =
  | { status: "created"; receiptId: string; category: string }
  | { status: "no_fee" }
  | { status: "switched_off" }
  | { status: "already_handled" };

export function feeExpenseNote(kind: FeeSource["kind"], documentNumber: number): string {
  const invoice = formatDocumentNumber("invoice", documentNumber);
  return kind === "payment"
    ? `Stripe fee on ${invoice} (recorded automatically)`
    : `Stripe dispute fee on ${invoice} (recorded automatically)`;
}

export async function recordStripeFeeExpense(admin: Admin, input: FeeExpenseInput): Promise<FeeExpenseResult> {
  const fee = input.fee == null ? 0 : round2(input.fee);
  if (!(fee > 0)) return { status: "no_fee" };

  const table = input.source.kind === "payment" ? "payments" : "stripe_disputes";
  const { data: row, error: readError } = await admin
    .from(table)
    .select("fee_expense_outcome")
    .eq("id", input.source.id)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (row?.fee_expense_outcome) return { status: "already_handled" };

  const { data: profile } = await admin
    .from("profiles")
    .select("record_stripe_fee_expenses")
    .eq("id", input.userId)
    .maybeSingle();
  if (profile?.record_stripe_fee_expenses === false) {
    // Remembered, so turning the switch on later does not pull in fees from payments made while it was off.
    const { error } = await admin
      .from(table)
      .update({ fee_expense_outcome: "off" })
      .eq("id", input.source.id)
      .is("fee_expense_outcome", null);
    if (error) throw new Error(error.message);
    return { status: "switched_off" };
  }

  const { state } = await ensureBankChargesCategory(admin, input.userId, [BANK_CHARGES_CATEGORY]);
  const category = state.state === "removed" ? FALLBACK_FEE_CATEGORY : state.name;

  const { data: receiptId, error } = await admin.rpc("record_stripe_fee_expense", {
    p_user_id: input.userId,
    p_payment_id: input.source.kind === "payment" ? input.source.id : null,
    p_dispute_id: input.source.kind === "dispute" ? input.source.id : null,
    p_merchant: STRIPE_FEE_MERCHANT,
    p_date: input.date,
    p_amount: fee,
    p_category: category,
    p_items: [{ name: feeExpenseNote(input.source.kind, input.documentNumber), amount: fee }],
  });
  if (error) throw new Error(error.message);
  return receiptId ? { status: "created", receiptId, category } : { status: "already_handled" };
}
