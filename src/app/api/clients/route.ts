import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";

export async function GET() {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const { data, error } = await result.supabase
    .from("clients")
    .select("*")
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ clients: data });
}

export async function POST(request: Request) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const body = await request.json();
  const { name, email, address } = body ?? {};

  if (!name?.trim()) {
    return NextResponse.json({ error: "Client name is required." }, { status: 400 });
  }

  const { data, error } = await result.supabase
    .from("clients")
    .insert({
      user_id: result.user.id,
      name: name.trim(),
      email: email?.trim() || null,
      address: address?.trim() || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ client: data }, { status: 201 });
}
