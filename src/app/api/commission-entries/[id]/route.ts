import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";

// Used only for the post-save "Customer name" auto-capture field - the
// entry itself is already saved by the time this fires, this just attaches
// an optional name to it.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase } = result;
  const { id } = await params;

  const body = await request.json();
  const { customer_name } = body ?? {};

  const { data, error } = await supabase
    .from("commission_entries")
    .update({ customer_name: customer_name?.trim() || null })
    .eq("id", id)
    .select("*, stylist:stylists(*), service:services(*)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entry: data });
}

// Backs the toast's "Undo" action right after a 2-tap log.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { id } = await params;

  const { error } = await result.supabase.from("commission_entries").delete().eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
