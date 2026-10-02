import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { findBankAccountByName, isUniqueViolation } from "@/lib/find-by-name";
import type { Database } from "@/lib/database.types";

// Rename, change type (bank/card) and/or deactivate/reactivate. There is deliberately no DELETE:
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
        { error: `An account named "${name}" already exists.` },
        { status: 409 },
      );
    }
    update.name = name;
  }
  if (body?.is_active !== undefined) update.is_active = !!body.is_active;

  if (body?.account_type !== undefined) {
    if (body.account_type !== "bank" && body.account_type !== "card") {
      return NextResponse.json({ error: "Account type must be bank or card." }, { status: 400 });
    }
    if (body.account_type === "card") {
      // A card can't receive a payment, so an account that already has
      // payments deposited to it can't become one - those payments would
      // point at something that is never offered under "Deposited to".
      const { count } = await supabase
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("bank_account_id", id);
      if ((count ?? 0) > 0) {
        return NextResponse.json(
          { error: "This account has payments deposited to it, so it can't become a credit card." },
          { status: 409 },
        );
      }
    }
    update.account_type = body.account_type;
  }

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
      { error: `An account named "${update.name}" already exists.` },
      { status: 409 },
    );
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Bank account not found." }, { status: 404 });
  return NextResponse.json({ bankAccount: data });
}
