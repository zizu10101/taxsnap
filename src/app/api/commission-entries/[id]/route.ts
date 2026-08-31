import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { STYLIST_PUBLIC_COLUMNS } from "@/lib/stylist-columns";
import type { CommissionEntryUpdate } from "@/lib/database.types";

// commission_entries has two FKs each to stylists (stylist_id,
// original_stylist_id) and services (service_id, original_service_id) as
// of 0018_commission_entry_edits.sql - explicit hints required, PostgREST
// can no longer infer which FK either embed should join through.
const ENTRY_SELECT = `*, stylist:stylists!commission_entries_stylist_id_fkey(${STYLIST_PUBLIC_COLUMNS}), service:services!commission_entries_service_id_fkey(*), payout:payouts(id, confirmed_by_stylist, confirmed_at, paid_at, status, total_amount, range_start, range_end)`;

// Corrects a same-day mislabel (wrong service/stylist tapped) on an unpaid
// entry - separate from DELETE below, and from the soft-delete boundary
// it enforces: this is a same-day fix, not a way to erase what happened.
// service_id/price_charged/commission_rate_applied are recomputed fresh
// from the (possibly new) service/stylist rows server-side, same
// never-trust-the-client reasoning as POST /api/commission-entries - the
// staff-facing edit flow re-does the same service/stylist picker, so there
// is no separate price/rate field here to tamper with either.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;
  const { id } = await params;

  const body = await request.json();
  const { service_id, stylist_id, customer_name } = body ?? {};

  if (!service_id || !stylist_id) {
    return NextResponse.json(
      { error: "service_id and stylist_id are required." },
      { status: 400 },
    );
  }

  // commission_entries never denormalized a stylist name onto the row the
  // way it already denormalizes service_name, so the pre-edit name (for
  // original_stylist_name below) only exists via this join - it's the
  // current name of whoever stylist_id already pointed to, read BEFORE
  // this edit's own stylist_id is applied.
  const { data: entry, error: fetchError } = await supabase
    .from("commission_entries")
    .select(
      `service_id, service_name, price_charged, stylist_id, customer_name, is_deleted, payout_id, edited_at, stylist:stylists!commission_entries_stylist_id_fkey(name)`,
    )
    .eq("id", id)
    .single();

  if (fetchError || !entry) {
    return NextResponse.json({ error: "Commission entry not found." }, { status: 404 });
  }

  // Same guard as DELETE, checked server-side for the same reason: a paid
  // entry's commission_owed is already summed into a payout's
  // total_amount, and a deleted entry is meant to be gone, not editable
  // back into existence.
  if (entry.is_deleted) {
    return NextResponse.json({ error: "Deleted entries can't be edited." }, { status: 400 });
  }
  if (entry.payout_id) {
    return NextResponse.json({ error: "Paid entries can't be edited." }, { status: 400 });
  }

  // A no-op save (the edit flow was opened and Submit tapped without
  // actually changing anything) must not create a trail - snapshotting
  // original_*/edited_at here would put an "Edited" badge on an entry with
  // no real diff behind it. Compare against the *stored* values, not
  // against each other, before touching anything else.
  const normalizedCustomerName = customer_name?.trim() || null;
  if (
    entry.service_id === service_id &&
    entry.stylist_id === stylist_id &&
    (entry.customer_name ?? null) === normalizedCustomerName
  ) {
    const { data, error } = await supabase
      .from("commission_entries")
      .select(ENTRY_SELECT)
      .eq("id", id)
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ entry: data });
  }

  const [{ data: stylist }, { data: service }] = await Promise.all([
    supabase
      .from("stylists")
      .select(STYLIST_PUBLIC_COLUMNS)
      .eq("id", stylist_id)
      .eq("user_id", user.id)
      .single(),
    supabase.from("services").select("*").eq("id", service_id).eq("user_id", user.id).single(),
  ]);

  if (!stylist) return NextResponse.json({ error: "Stylist not found." }, { status: 404 });
  if (!service) return NextResponse.json({ error: "Service not found." }, { status: 404 });

  const update: CommissionEntryUpdate = {
    stylist_id,
    service_id,
    service_name: service.name,
    price_charged: service.default_price,
    commission_rate_applied: stylist.commission_rate,
    customer_name: customer_name?.trim() || null,
  };

  // Snapshot the pre-edit service/price/stylist on the FIRST edit only. A
  // second edit leaves original_* and edited_at exactly as the first edit
  // set them - always "what was first entered" vs. "what it is now," never
  // a multi-hop chain of edit-over-edit. A wrong-stylist correction is
  // tracked the same as a wrong service - it silently moves commission
  // between two people otherwise, with no way to see it happened.
  if (!entry.edited_at) {
    update.original_service_id = entry.service_id;
    update.original_service_name = entry.service_name;
    update.original_price = entry.price_charged;
    update.original_stylist_id = entry.stylist_id;
    update.original_stylist_name = entry.stylist?.name ?? null;
    update.edited_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("commission_entries")
    .update(update)
    .eq("id", id)
    .select(ENTRY_SELECT)
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
  const result = await requireUser();
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
