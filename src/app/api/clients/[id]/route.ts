import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { normalizePhone } from "@/lib/client-phone";
import { handleClientDelete } from "@/lib/client-delete-server";
import type { ClientUpdate } from "@/lib/database.types";
import {
  findClientByName,
  duplicateClientMessage,
  isUniqueViolation,
} from "@/lib/find-by-name";

// Editing a client's contact info. Delete is below (only for a client with no records).
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
  const { name, email, address, phone } = body ?? {};

  const update: ClientUpdate = {};
  if (name !== undefined) {
    if (!name?.trim()) {
      return NextResponse.json({ error: "Client name is required." }, { status: 400 });
    }
    if (await findClientByName(supabase, user.id, name, id)) {
      return NextResponse.json({ error: duplicateClientMessage(name) }, { status: 409 });
    }
    update.name = name.trim();
  }
  if (email !== undefined) update.email = email?.trim() || null;
  if (address !== undefined) update.address = address?.trim() || null;
  if (phone !== undefined) {
    const phoneResult = normalizePhone(phone);
    if (!phoneResult.ok) {
      return NextResponse.json({ error: phoneResult.error }, { status: 400 });
    }
    update.phone = phoneResult.value;
  }

  const { data, error } = await supabase
    .from("clients")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (isUniqueViolation(error) && update.name) {
    return NextResponse.json({ error: duplicateClientMessage(update.name) }, { status: 409 });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ client: data });
}

// Deletes a client that nothing points at. A client with invoices, estimates or jobs answers 409 with the
// counts (rules and reasons in lib/client-delete-server.ts).
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { id } = await params;

  const { status, body } = await handleClientDelete(result.supabase, result.user.id, id);
  return NextResponse.json(body, { status });
}
