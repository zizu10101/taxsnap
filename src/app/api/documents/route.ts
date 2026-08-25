import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";
import { ONTARIO_HST_RATE } from "@/lib/hst";
import type { DocumentType } from "@/lib/database.types";

const DOCUMENT_TYPES: DocumentType[] = ["invoice", "estimate"];

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export async function GET(request: Request) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");

  let query = result.supabase
    .from("documents")
    .select("*, client:clients(*), payments(*)")
    .order("issue_date", { ascending: false });

  if (type && DOCUMENT_TYPES.includes(type as DocumentType)) {
    query = query.eq("type", type as DocumentType);
  }

  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ documents: data });
}

interface ItemInput {
  description: string;
  quantity: number;
  unit_price: number;
}

export async function POST(request: Request) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;

  const body = await request.json();
  const {
    type,
    status,
    issue_date,
    due_date,
    client_id: clientIdInput,
    new_client,
    items,
  } = body ?? {};

  if (!DOCUMENT_TYPES.includes(type)) {
    return NextResponse.json(
      { error: "type must be 'invoice' or 'estimate'." },
      { status: 400 },
    );
  }
  if (!issue_date) {
    return NextResponse.json({ error: "issue_date is required." }, { status: 400 });
  }
  const cleanItems: ItemInput[] = Array.isArray(items)
    ? items.filter((i: ItemInput) => i?.description?.trim())
    : [];
  if (cleanItems.length === 0) {
    return NextResponse.json(
      { error: "At least one line item is required." },
      { status: 400 },
    );
  }

  let clientId: string | null = clientIdInput ?? null;
  if (!clientId && new_client?.name?.trim()) {
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .insert({
        user_id: user.id,
        name: new_client.name.trim(),
        email: new_client.email?.trim() || null,
        address: new_client.address?.trim() || null,
      })
      .select()
      .single();

    if (clientError) {
      return NextResponse.json({ error: clientError.message }, { status: 500 });
    }
    clientId = client.id;
  }

  const subtotal = round2(
    cleanItems.reduce(
      (sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0),
      0,
    ),
  );
  const hstAmount = round2(subtotal * ONTARIO_HST_RATE);
  const totalAmount = round2(subtotal + hstAmount);

  const { data: document, error: documentError } = await supabase
    .from("documents")
    .insert({
      user_id: user.id,
      client_id: clientId,
      type,
      status: status === "sent" || status === "paid" ? status : "draft",
      issue_date,
      due_date: due_date || null,
      subtotal,
      hst_amount: hstAmount,
      total_amount: totalAmount,
    })
    .select("*, client:clients(*), payments(*)")
    .single();

  if (documentError) {
    return NextResponse.json({ error: documentError.message }, { status: 500 });
  }

  const { data: insertedItems, error: itemsError } = await supabase
    .from("document_items")
    .insert(
      cleanItems.map((item, index) => ({
        document_id: document.id,
        description: item.description.trim(),
        quantity: Number(item.quantity) || 0,
        unit_price: Number(item.unit_price) || 0,
        sort_order: index,
      })),
    )
    .select();

  if (itemsError) {
    // Roll back the document so we don't leave an item-less orphan behind.
    await supabase.from("documents").delete().eq("id", document.id);
    return NextResponse.json({ error: itemsError.message }, { status: 500 });
  }

  return NextResponse.json(
    { document: { ...document, items: insertedItems } },
    { status: 201 },
  );
}
