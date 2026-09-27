import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { wouldExceedActiveLimit, limitReachedMessage } from "@/lib/plan-limits";

export async function GET() {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const { data, error } = await result.supabase
    .from("products")
    .select("*")
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ products: data });
}

export async function POST(request: Request) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;

  const body = await request.json();
  const { name, default_price } = body ?? {};

  if (!name?.trim()) {
    return NextResponse.json({ error: "Product name is required." }, { status: 400 });
  }

  // Every tier gets a capped number of active products (see
  // src/lib/plan-limits.ts), same shape as the pre-existing services cap -
  // a new product always inserts as active, so this is checked
  // unconditionally here rather than only when the caller explicitly
  // passes is_active.
  const activeCheck = await wouldExceedActiveLimit(supabase, user.id, "products");
  if (activeCheck.exceeded) {
    return NextResponse.json(
      {
        error: limitReachedMessage(activeCheck, "active product"),
        code: "FREE_LIMIT_REACHED",
      },
      { status: 403 },
    );
  }

  const { data, error } = await supabase
    .from("products")
    .insert({
      user_id: user.id,
      name: name.trim(),
      default_price: Number(default_price) || 0,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ product: data }, { status: 201 });
}
