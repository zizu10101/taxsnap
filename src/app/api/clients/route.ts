import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { wouldExceedTotalLimit, limitReachedMessage } from "@/lib/plan-limits";

export async function GET() {
  const result = await requireUser();
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
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;

  const body = await request.json();
  const { name, email, address } = body ?? {};

  if (!name?.trim()) {
    return NextResponse.json({ error: "Client name is required." }, { status: 400 });
  }

  // Every tier gets a capped number of clients (see src/lib/plan-limits.ts).
  const totalCheck = await wouldExceedTotalLimit(supabase, user.id, "clients");
  if (totalCheck.exceeded) {
    return NextResponse.json(
      { error: limitReachedMessage(totalCheck, "client"), code: "FREE_LIMIT_REACHED" },
      { status: 403 },
    );
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
