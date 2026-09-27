import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import type { RentPaymentUpdate } from "@/lib/database.types";

// Plain editable log row, no edit-trail - this is intentionally simple,
// private record-keeping with no downstream consequence (no payout
// batching, no commission math), unlike commission_entries' PATCH.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase } = result;
  const { id } = await params;

  const body = await request.json();
  const { paid_date, amount } = body ?? {};

  const update: RentPaymentUpdate = {};
  if (paid_date !== undefined) update.paid_date = paid_date;
  if (amount !== undefined) {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return NextResponse.json({ error: "amount must be a positive number." }, { status: 400 });
    }
    update.amount = numericAmount;
  }

  const { data, error } = await supabase
    .from("rent_payments")
    .update(update)
    .eq("id", id)
    .select("*, renter:renters(id, name)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ payment: data });
}

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

  const { error } = await supabase.from("rent_payments").delete().eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
