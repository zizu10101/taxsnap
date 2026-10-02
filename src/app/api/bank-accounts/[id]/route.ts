import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { findBankAccountByName, isUniqueViolation } from "@/lib/find-by-name";
import type { Database } from "@/lib/database.types";

// Rename and/or deactivate/reactivate. There is deliberately no DELETE:
// payments.bank_account_id points here, and removing an account must not
// erase "Deposited to" on historical payments - is_active=false just hides
// it from the picker.
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
  const update: Database["public"]["Tables"]["bank_accounts"]["Update"] = {};

  if (body?.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "Account name is required." }, { status: 400 });
    }
    if (await findBankAccountByName(supabase, user.id, name, id)) {
      return NextResponse.json(
        { error: `A bank account named "${name}" already exists.` },
        { status: 409 },
      );
    }
    update.name = name;
  }
  if (body?.is_active !== undefined) update.is_active = !!body.is_active;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("bank_accounts")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .maybeSingle();

  if (isUniqueViolation(error) && update.name) {
    return NextResponse.json(
      { error: `A bank account named "${update.name}" already exists.` },
      { status: 409 },
    );
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Bank account not found." }, { status: 404 });
  return NextResponse.json({ bankAccount: data });
}
