import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";

// Undo for the whole multi-item cart, backing the Register's post-Submit
// toast action - same soft-delete shape as DELETE
// /api/commission-entries/[id], just applied to every line item (service
// and product) on the transaction at once instead of a single entry.
// register_transactions.subtotal/tax_amount/total_amount are never
// touched - the header stays the immutable record of what was actually
// charged (see 0036_register_transactions.sql), same principle as
// payouts.total_amount never drifting after the fact.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase } = result;
  const { id } = await params;

  const { data: transaction, error: fetchError } = await supabase
    .from("register_transactions")
    .select("id")
    .eq("id", id)
    .single();

  if (fetchError || !transaction) {
    return NextResponse.json({ error: "Transaction not found." }, { status: 404 });
  }

  const { data: entries } = await supabase
    .from("commission_entries")
    .select("id, payout_id")
    .eq("transaction_id", id);

  // Same guard as DELETE /api/commission-entries/[id] - a service item
  // already folded into a stylist's payout can't be undone out from under
  // it, so neither can the transaction it belongs to.
  if ((entries ?? []).some((e) => e.payout_id)) {
    return NextResponse.json(
      { error: "A paid entry on this transaction can't be undone." },
      { status: 400 },
    );
  }

  const deletedAt = new Date().toISOString();

  const [entriesResult, productsResult] = await Promise.all([
    supabase
      .from("commission_entries")
      .update({ is_deleted: true, deleted_at: deletedAt })
      .eq("transaction_id", id),
    supabase
      .from("register_transaction_products")
      .update({ is_deleted: true, deleted_at: deletedAt })
      .eq("transaction_id", id),
  ]);

  if (entriesResult.error) {
    return NextResponse.json({ error: entriesResult.error.message }, { status: 500 });
  }
  if (productsResult.error) {
    return NextResponse.json({ error: productsResult.error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
