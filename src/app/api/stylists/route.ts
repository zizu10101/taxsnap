import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";
import { toTitleCase } from "@/lib/format-name";
import { STYLIST_PUBLIC_COLUMNS } from "@/lib/stylist-columns";
import type { PayType } from "@/lib/database.types";

const PAY_TYPES: PayType[] = ["commission", "hourly", "salary"];

export async function GET() {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const { data, error } = await result.supabase
    .from("stylists")
    .select(STYLIST_PUBLIC_COLUMNS)
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ stylists: data });
}

export async function POST(request: Request) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;

  const body = await request.json();
  const { name, pay_type, commission_rate } = body ?? {};

  if (!name?.trim()) {
    return NextResponse.json({ error: "Stylist name is required." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("stylists")
    .insert({
      user_id: user.id,
      name: toTitleCase(name),
      pay_type: PAY_TYPES.includes(pay_type) ? pay_type : "commission",
      commission_rate: Number(commission_rate) || 0,
    })
    .select(STYLIST_PUBLIC_COLUMNS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ stylist: data }, { status: 201 });
}
