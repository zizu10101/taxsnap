import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";
import { toTitleCase } from "@/lib/format-name";

export async function GET() {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const { data, error } = await result.supabase
    .from("employees")
    .select("*")
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ employees: data });
}

export async function POST(request: Request) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;

  const body = await request.json();
  const { name, default_hourly_rate } = body ?? {};

  if (!name?.trim()) {
    return NextResponse.json({ error: "Employee name is required." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("employees")
    .insert({
      user_id: user.id,
      name: toTitleCase(name),
      default_hourly_rate: Number(default_hourly_rate) || 0,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ employee: data }, { status: 201 });
}
