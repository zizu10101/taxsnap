import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";
import { STYLIST_PUBLIC_COLUMNS } from "@/lib/stylist-columns";

// Not called by the current 3-tap logging flow (customer_name is set at
// creation time now, see POST /api/commission-entries) - left in place as
// a harmless, still-useful way to edit a customer name after the fact
// (e.g. from Reports).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase } = result;
  const { id } = await params;

  const body = await request.json();
  const { customer_name } = body ?? {};

  const { data, error } = await supabase
    .from("commission_entries")
    .update({ customer_name: customer_name?.trim() || null })
    .eq("id", id)
    .select(`*, stylist:stylists(${STYLIST_PUBLIC_COLUMNS}), service:services(*), payout:payouts(id, confirmed_by_stylist, confirmed_at, paid_at)`)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entry: data });
}

// Soft delete, not a hard delete: backs both the toast's "Undo" action
// right after a 3-tap log, and the Reports delete button. A paid entry
// (payout_id set) can never be deleted through here - checked server-side
// since a disabled button in the UI is not enough, a paid entry's
// commission_owed has already been summed into a payout's total_amount,
// and deleting it out from under that payout would make the total wrong
// with no way to detect it.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase } = result;
  const { id } = await params;

  const { data: entry, error: fetchError } = await supabase
    .from("commission_entries")
    .select("payout_id")
    .eq("id", id)
    .single();

  if (fetchError || !entry) {
    return NextResponse.json({ error: "Commission entry not found." }, { status: 404 });
  }

  if (entry.payout_id) {
    return NextResponse.json(
      { error: "Paid entries can't be deleted." },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from("commission_entries")
    .update({ is_deleted: true, deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
