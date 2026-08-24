import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase.from("sales").select("*");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ sales: data });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { period_label, gross_sales, cash_deposits } = body ?? {};

  if (!period_label) {
    return NextResponse.json(
      { error: "period_label is required." },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("sales")
    .upsert(
      {
        user_id: user.id,
        period_label,
        gross_sales: Number(gross_sales) || 0,
        cash_deposits: Number(cash_deposits) || 0,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,period_label" },
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ sales: data });
}
