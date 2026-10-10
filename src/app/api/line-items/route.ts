import { sortSavedItems } from "@/lib/saved-items";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { createLineItem } from "@/lib/line-items-server";

export async function GET() {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const { data, error } = await result.supabase
    .from("line_items")
    .select("*");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ lineItems: sortSavedItems(data ?? []) });
}

export async function POST(request: Request) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const { status, body } = await createLineItem(
    result.supabase,
    result.user.id,
    await request.json(),
  );
  return NextResponse.json(body, { status });
}
