import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { nextServiceColor } from "@/lib/service-colors";
import { wouldExceedFreeTierActiveLimit } from "@/lib/free-tier-limits";

export async function GET() {
  const result = await requireUser();
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
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;

  const body = await request.json();
  const { name, default_price, color } = body ?? {};

  if (!name?.trim()) {
    return NextResponse.json({ error: "Service name is required." }, { status: 400 });
  }

  // Free-tier salon accounts get 1 free active service as a preview - a
  // new service always inserts as active, so this is checked unconditionally
  // here rather than only when the caller explicitly passes is_active.
  if (await wouldExceedFreeTierActiveLimit(supabase, user.id, "services")) {
    return NextResponse.json(
      {
        error: "Free accounts can have 1 active service. Upgrade to Pro to add more.",
        code: "FREE_LIMIT_REACHED",
      },
      { status: 403 },
    );
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
