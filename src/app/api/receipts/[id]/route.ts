import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { TAX_CATEGORIES } from "@/lib/tax-categories";

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
    items_summary,
    job_name,
  } = body ?? {};

  if (!merchant_name || !transaction_date || total_amount === undefined) {
    return NextResponse.json(
      { error: "merchant_name, transaction_date, and total_amount are required." },
      { status: 400 },
    );
  }

  const category = TAX_CATEGORIES.includes(tax_category) ? tax_category : "Other";

  const { data, error } = await supabase
    .from("receipts")
    .update({
      merchant_name,
      transaction_date,
      total_amount: Number(total_amount) || 0,
      tax_amount: Number(tax_amount) || 0,
      tax_category: category,
      job_name: job_name?.trim() || null,
      items: items_summary ? [{ name: items_summary, amount: 0 }] : [],
    })
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

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
