import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getNextDocumentNumber } from "@/lib/document-number";
import { wouldExceedMonthlyLimit, type LimitCheck } from "@/lib/plan-limits";
import { generateOpaqueToken } from "@/lib/opaque-token";

export class EstimateNotFoundError extends Error {
  constructor() {
    super("Estimate not found.");
  }
}

export class EstimateAlreadyConvertedError extends Error {
  invoiceId: string;
  constructor(invoiceId: string) {
    super("This estimate has already been converted to an invoice.");
    this.invoiceId = invoiceId;
  }
}

export class MonthlyLimitExceededError extends Error {
  check: LimitCheck;
  constructor(check: LimitCheck) {
    super("Monthly invoice limit exceeded.");
    this.check = check;
  }
}

interface ConvertOptions {
  // Only the public sign flow needs a view_token (for the "your invoice is
  // ready" email link) - the owner's own authenticated "Convert to
  // Invoice" button never needs a public link, so it doesn't generate one.
  generateViewToken?: boolean;
  // Only the public sign flow bypasses the monthly invoice cap - a
  // client's signature should never fail because of the contractor's plan
  // tier. The owner's own manual conversion still respects it. When
  // bypassed and the cap was in fact exceeded, the new invoice is flagged
  // created_past_plan_limit so the dashboard can surface an upgrade nudge
  // afterward, without ever having blocked the conversion itself.
  bypassMonthlyLimit?: boolean;
}

// Shared by the authenticated POST /api/documents/[id]/convert (owner taps
// "Convert to Invoice") and the public POST /api/sign/[token] (a client's
// signature triggers this automatically) - one conversion implementation,
// not two to keep in sync. Duplicates an estimate as a new draft invoice,
// carrying over the client, job link, and line items; the original
// estimate is left untouched.
export async function convertEstimateToInvoice(
  supabase: SupabaseClient<Database>,
  estimateId: string,
  userId: string,
  options: ConvertOptions = {},
) {
  const { data: estimate, error: fetchError } = await supabase
    .from("documents")
    .select("*, items:document_items(*)")
    .eq("id", estimateId)
    .eq("user_id", userId)
    .eq("type", "estimate")
    .single();

  if (fetchError || !estimate) {
    throw new EstimateNotFoundError();
  }

  const { data: existingConversion } = await supabase
    .from("documents")
    .select("id")
    .eq("converted_from_id", estimate.id)
    .maybeSingle();

  if (existingConversion) {
    throw new EstimateAlreadyConvertedError(existingConversion.id);
  }

  const monthlyCheck = await wouldExceedMonthlyLimit(supabase, userId, "invoices");
  if (monthlyCheck.exceeded && !options.bypassMonthlyLimit) {
    throw new MonthlyLimitExceededError(monthlyCheck);
  }
  const createdPastPlanLimit = monthlyCheck.exceeded && !!options.bypassMonthlyLimit;

  const documentNumber = await getNextDocumentNumber(supabase, userId, "invoice");
  const viewToken = options.generateViewToken ? generateOpaqueToken() : null;

  const { data: invoice, error: insertError } = await supabase
    .from("documents")
    .insert({
      user_id: userId,
      client_id: estimate.client_id,
      job_id: estimate.job_id,
      place_of_work: estimate.place_of_work,
      type: "invoice",
      status: "draft",
      issue_date: new Date().toISOString().slice(0, 10),
      due_date: estimate.due_date,
      subtotal: estimate.subtotal,
      hst_amount: estimate.hst_amount,
      total_amount: estimate.total_amount,
      converted_from_id: estimate.id,
      document_number: documentNumber,
      view_token: viewToken,
      created_past_plan_limit: createdPastPlanLimit,
    })
    .select("*, client:clients(*), job:jobs(*), payments(*)")
    .single();

  if (insertError) {
    throw new Error(insertError.message);
  }

  const items = estimate.items ?? [];
  const { data: insertedItems, error: itemsError } = await supabase
    .from("document_items")
    .insert(
      items.map(
        (item: { description: string; quantity: number; unit_price: number; sort_order: number }) => ({
          document_id: invoice.id,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          sort_order: item.sort_order,
        }),
      ),
    )
    .select();

  if (itemsError) {
    await supabase.from("documents").delete().eq("id", invoice.id);
    throw new Error(itemsError.message);
  }

  return { ...invoice, items: insertedItems };
}
