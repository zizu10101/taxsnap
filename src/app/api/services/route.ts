import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";
import { nextServiceColor } from "@/lib/service-colors";

export async function GET() {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const { data, error } = await result.supabase
    .from("services")
    .select("*")
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ services: data });
}

export async function POST(request: Request) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;

  const body = await request.json();
  const { name, default_price, color } = body ?? {};

  if (!name?.trim()) {
    return NextResponse.json({ error: "Service name is required." }, { status: 400 });
  }

  let assignedColor = color;
  if (!assignedColor) {
    const { count } = await supabase
      .from("services")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);
    assignedColor = nextServiceColor(count ?? 0);
  }

  const { data, error } = await supabase
    .from("services")
    .insert({
      user_id: user.id,
      name: name.trim(),
      default_price: Number(default_price) || 0,
      color: assignedColor,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ service: data }, { status: 201 });
}
