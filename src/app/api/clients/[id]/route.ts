import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import type { ClientUpdate } from "@/lib/database.types";

// Editing a client's contact info - no delete route exists, same
// no-delete-UI choice already made for jobs/employees (client_id on
// documents is "on delete set null" so a delete would be schema-safe, but
// there's no product need for it yet, matching the rest of the app).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;
  const { id } = await params;

  const body = await request.json();
  const { name, email, address } = body ?? {};

  const update: ClientUpdate = {};
  if (name !== undefined) {
    if (!name?.trim()) {
      return NextResponse.json({ error: "Client name is required." }, { status: 400 });
    }
    update.name = name.trim();
  }
  if (email !== undefined) update.email = email?.trim() || null;
  if (address !== undefined) update.address = address?.trim() || null;

  const { data, error } = await supabase
    .from("clients")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ client: data });
}
