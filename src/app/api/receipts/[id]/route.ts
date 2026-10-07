import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveCategory } from "@/lib/expense-categories";
import { resolvePaidWithAccountId } from "@/lib/payments";
import type { ReceiptItem } from "@/lib/database.types";
import { loadCategoryRows } from "@/lib/statement-bank-charges";
import { bankChargesSuggestion, resolveBankCharges } from "@/lib/statement-categories";
import { buildCategoryDefaults, drawerTaxCode, isCalculated, taxAfterCategoryChange } from "@/lib/tax-codes";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function sanitizeItems(items: unknown): ReceiptItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is ReceiptItem => !!item?.name?.trim())
    .map((item) => ({
      name: item.name.trim(),
      amount: Number(item.amount) || 0,
    }));
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const {
    merchant_name,
    transaction_date,
    total_amount,
    tax_amount,
    tax_category,
    items,
    job_name,
    paid_with_account_id,
    tax_code,
  } = body ?? {};

  if (!merchant_name || !transaction_date || total_amount === undefined) {
    return NextResponse.json(
      { error: "merchant_name, transaction_date, and total_amount are required." },
      { status: 400 },
    );
  }

  const category = await resolveCategory(supabase, user.id, tax_category);

  // Only touched when the client sent the field; an explicit null/"" clears it.
  const paidWith = await resolvePaidWithAccountId(supabase, user.id, paid_with_account_id);
  if ("error" in paidWith) {
    return NextResponse.json({ error: paidWith.error }, { status: paidWith.status });
  }

  // A card-statement expense with no receipt carries a CALCULATED tax and a tax code. Editing it here
  // either follows the category (a code that came from the category's default) or, if the owner
  // types a different tax figure, replaces the calculation - the code goes with it. Rows with no
  // code (every ordinary receipt) skip all of this and are saved exactly as before.
  const newTotal = Number(total_amount) || 0;
  let newTax = Number(tax_amount) || 0;
  let taxCode: {
    tax_rate: number | null;
    itc_pct: number | null;
    deductible_pct: number | null;
    tax_source: "line" | "rule" | "foreign_currency" | "category" | "kind" | null;
  } | null = null;
  const { data: existing } = await supabase
    .from("receipts")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (tax_code !== undefined) {
    // The owner applied a tax code to a statement expense that has no receipt yet. The tax is
    // recalculated here (tax-included, from the total being saved) and the code is marked as their own
    // pick; whatever tax figure the form carried is ignored. Refused for anything else: an expense
    // with a receipt (or one the owner entered) has a confirmed figure a code must never overwrite.
    const decided = drawerTaxCode(existing, newTotal, tax_code);
    if (!decided.ok) return NextResponse.json({ error: decided.error }, { status: 400 });
    const patch = decided.patch;
    newTax = patch.tax_amount;
    taxCode = {
      tax_rate: patch.tax_rate,
      itc_pct: patch.itc_pct,
      deductible_pct: patch.deductible_pct,
      tax_source: patch.tax_source,
    };
  } else if (existing && isCalculated(existing) && existing.tax_source) {
    if (round2(newTax) !== round2(Number(existing.tax_amount))) {
      taxCode = { tax_rate: null, itc_pct: null, deductible_pct: null, tax_source: null };
    } else if (category.toLowerCase() !== existing.tax_category.toLowerCase()) {
      const defaults = buildCategoryDefaults({
        bankChargesName: bankChargesSuggestion(resolveBankCharges(await loadCategoryRows(supabase, user.id))),
      });
      const patch = taxAfterCategoryChange({ ...existing, total_amount: newTotal }, category, defaults);
      if (patch) {
        newTax = patch.tax_amount;
        taxCode = {
          tax_rate: patch.tax_rate,
          itc_pct: patch.itc_pct,
          deductible_pct: patch.deductible_pct,
          tax_source: patch.tax_source,
        };
      }
    }
  }

  let update = supabase
    .from("receipts")
    .update({
      merchant_name,
      transaction_date,
      total_amount: newTotal,
      tax_amount: newTax,
      ...(taxCode ?? {}),
      tax_category: category,
      job_name: job_name?.trim() || null,
      ...(paid_with_account_id !== undefined && { paid_with_account_id: paidWith.id }),
      items: sanitizeItems(items),
    })
    .eq("id", id)
    .eq("user_id", user.id);
  // A tax code is only ever applied to an expense that STILL has no receipt: if one was attached while
  // this form was open, nothing is written (its actual tax stands) rather than overwriting it.
  if (tax_code !== undefined) update = update.eq("no_receipt", true);
  const { data, error } = await update.select().maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data && tax_code !== undefined) {
    return NextResponse.json(
      { error: "A receipt was attached to this expense, so a tax code can't be set. Reload it.", code: "RECEIPT_ATTACHED" },
      { status: 409 },
    );
  }
  if (!data) return NextResponse.json({ error: "Receipt not found." }, { status: 404 });

  return NextResponse.json({ receipt: data });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const { data: receipt } = await supabase
    .from("receipts")
    .select("image_url")
    .eq("id", id)
    .single();

  const { error } = await supabase
    .from("receipts")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (receipt?.image_url) {
    await supabase.storage.from("receipts").remove([receipt.image_url]);
  }

  return NextResponse.json({ success: true });
}
