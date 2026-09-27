import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { STYLIST_PUBLIC_COLUMNS } from "@/lib/stylist-columns";
import { ONTARIO_HST_RATE } from "@/lib/hst";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

type ServiceCartItem = { kind: "service"; service_id: string; stylist_id: string };
type ProductCartItem = { kind: "product"; product_id: string };
type CartItem = ServiceCartItem | ProductCartItem;

const ENTRY_SELECT = `*, stylist:stylists!commission_entries_stylist_id_fkey(${STYLIST_PUBLIC_COLUMNS}), service:services!commission_entries_service_id_fkey(*), payout:payouts(id, confirmed_by_stylist, confirmed_at, paid_at, status, total_amount, range_start, range_end)`;

// Register's own "Today's entries" list (staff mode) needs to show product
// line items too, which don't live in commission_entries at all - this
// nests them under their parent transaction so the client can group a
// multi-item sale back together for display.
export async function GET(request: Request) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase } = result;

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let query = supabase
    .from("register_transactions")
    .select("*, register_transaction_products(*)")
    .order("created_at", { ascending: false });

  if (from) query = query.gte("created_at", from);
  if (to) query = query.lt("created_at", to);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Soft-deleted product line items (Undo) are filtered out here rather
  // than via the query builder - PostgREST resource embedding doesn't
  // support filtering an embedded array's own rows through supabase-js's
  // chainable .eq(), only the top-level rows.
  const transactions = (data ?? []).map((t) => ({
    ...t,
    register_transaction_products: (t.register_transaction_products ?? []).filter(
      (p: { is_deleted: boolean }) => !p.is_deleted,
    ),
  }));

  return NextResponse.json({ transactions });
}

// Cart-style multi-item checkout: one or more services (each with its own
// stylist) and/or products, rung up as a single sale. Every price/rate/tax
// value is looked up and computed here (server-side, from the live
// service/stylist/product rows) rather than trusted from the client - same
// boundary the old single-entry POST /api/commission-entries already
// used - then handed to the create_register_transaction() RPC, which does
// the atomic multi-row write and re-verifies ownership of every id itself.
export async function POST(request: Request) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;

  const body = await request.json();
  const { items, customer_name, payment_method, tax_applied } = body ?? {};

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "At least one item is required." }, { status: 400 });
  }
  if (!payment_method) {
    return NextResponse.json({ error: "payment_method is required." }, { status: 400 });
  }

  const cartItems = items as CartItem[];
  const serviceItems = cartItems.filter((i): i is ServiceCartItem => i.kind === "service");
  const productItems = cartItems.filter((i): i is ProductCartItem => i.kind === "product");

  for (const item of serviceItems) {
    if (!item.service_id || !item.stylist_id) {
      return NextResponse.json(
        { error: "Each service item needs a service_id and stylist_id." },
        { status: 400 },
      );
    }
  }
  for (const item of productItems) {
    if (!item.product_id) {
      return NextResponse.json({ error: "Each product item needs a product_id." }, { status: 400 });
    }
  }

  const serviceIds = [...new Set(serviceItems.map((i) => i.service_id))];
  const stylistIds = [...new Set(serviceItems.map((i) => i.stylist_id))];
  const productIds = [...new Set(productItems.map((i) => i.product_id))];

  const [{ data: services }, { data: stylists }, { data: products }] = await Promise.all([
    serviceIds.length
      ? supabase.from("services").select("*").eq("user_id", user.id).in("id", serviceIds)
      : Promise.resolve({ data: [] }),
    stylistIds.length
      ? supabase
          .from("stylists")
          .select(STYLIST_PUBLIC_COLUMNS)
          .eq("user_id", user.id)
          .in("id", stylistIds)
      : Promise.resolve({ data: [] }),
    productIds.length
      ? supabase.from("products").select("*").eq("user_id", user.id).in("id", productIds)
      : Promise.resolve({ data: [] }),
  ]);

  const serviceMap = new Map((services ?? []).map((s) => [s.id, s]));
  const stylistMap = new Map((stylists ?? []).map((s) => [s.id, s]));
  const productMap = new Map((products ?? []).map((p) => [p.id, p]));

  const isTaxApplied = tax_applied === true;

  const p_services = [];
  for (const item of serviceItems) {
    const service = serviceMap.get(item.service_id);
    const stylist = stylistMap.get(item.stylist_id);
    if (!service) return NextResponse.json({ error: "Service not found." }, { status: 404 });
    if (!stylist) return NextResponse.json({ error: "Stylist not found." }, { status: 404 });
    p_services.push({
      service_id: service.id,
      stylist_id: stylist.id,
      price_charged: service.default_price,
      commission_rate_applied: stylist.commission_rate,
      tax_amount: isTaxApplied ? round2(service.default_price * ONTARIO_HST_RATE) : null,
    });
  }

  const p_products = [];
  for (const item of productItems) {
    const product = productMap.get(item.product_id);
    if (!product) return NextResponse.json({ error: "Product not found." }, { status: 404 });
    p_products.push({
      product_id: product.id,
      price_charged: product.default_price,
      tax_amount: isTaxApplied ? round2(product.default_price * ONTARIO_HST_RATE) : null,
    });
  }

  const { data: transaction, error: rpcError } = await supabase.rpc(
    "create_register_transaction",
    {
      p_customer_name: customer_name?.trim() || null,
      p_payment_method: payment_method,
      p_tax_applied: isTaxApplied,
      p_services,
      p_products,
    },
  );

  if (rpcError) return NextResponse.json({ error: rpcError.message }, { status: 500 });

  const [{ data: entries }, { data: transactionProducts }] = await Promise.all([
    supabase
      .from("commission_entries")
      .select(ENTRY_SELECT)
      .eq("transaction_id", transaction.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("register_transaction_products")
      .select("*")
      .eq("transaction_id", transaction.id)
      .order("created_at", { ascending: true }),
  ]);

  return NextResponse.json(
    { transaction, entries: entries ?? [], products: transactionProducts ?? [] },
    { status: 201 },
  );
}
