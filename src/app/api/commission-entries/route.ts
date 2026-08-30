import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";
import { STYLIST_PUBLIC_COLUMNS } from "@/lib/stylist-columns";

export async function GET(request: Request) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase } = result;

  const { searchParams } = new URL(request.url);
  const stylistId = searchParams.get("stylist_id");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const status = searchParams.get("status"); // "unpaid" | "paid" | null

  let query = supabase
    .from("commission_entries")
    .select(`*, stylist:stylists!commission_entries_stylist_id_fkey(${STYLIST_PUBLIC_COLUMNS}), service:services!commission_entries_service_id_fkey(*), payout:payouts(id, confirmed_by_stylist, confirmed_at, paid_at, status, total_amount, range_start, range_end)`)
    // Soft-deleted entries are never included in any normal view -
    // there's no "trash" view built, so deleted just means gone here.
    .eq("is_deleted", false)
    .order("created_at", { ascending: false });

  if (stylistId) query = query.eq("stylist_id", stylistId);
  // from/to are full UTC instants (see lib/date-range.ts's rangeToUtcBounds)
  // representing shop-local midnight boundaries, not bare dates - created_at
  // is a timestamptz, and comparing it against a bare "YYYY-MM-DD" string
  // would be implicitly interpreted in the database's session timezone
  // (UTC), not the shop's local timezone, silently shifting the window by
  // the shop's UTC offset. The client computes these instants (it's the
  // only side that knows the shop's real local offset), so this route just
  // compares them directly - "to" is already the exclusive upper bound.
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lt("created_at", to);
  if (status === "unpaid") query = query.is("payout_id", null);
  if (status === "paid") query = query.not("payout_id", "is", null);

  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entries: data });
}

// The 3-tap logging flow: service tap, stylist tap, then a customer-name
// step that submits explicitly. price_charged/commission_rate_applied are
// looked up fresh from the service/stylist rows server-side (never trusted
// from the client) since there's no editable price/rate step in this flow
// to tamper with anyway, and it guarantees the snapshot reflects what was
// actually on file at the moment of submit.
export async function POST(request: Request) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;

  const body = await request.json();
  const { stylist_id, service_id, customer_name } = body ?? {};

  if (!stylist_id || !service_id) {
    return NextResponse.json(
      { error: "stylist_id and service_id are required." },
      { status: 400 },
    );
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

  const { data, error } = await supabase
    .from("commission_entries")
    .insert({
      user_id: user.id,
      stylist_id,
      service_id,
      service_name: service.name,
      customer_name: customer_name?.trim() || null,
      price_charged: service.default_price,
      commission_rate_applied: stylist.commission_rate,
    })
    .select(`*, stylist:stylists!commission_entries_stylist_id_fkey(${STYLIST_PUBLIC_COLUMNS}), service:services!commission_entries_service_id_fkey(*), payout:payouts(id, confirmed_by_stylist, confirmed_at, paid_at, status, total_amount, range_start, range_end)`)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entry: data }, { status: 201 });
}
