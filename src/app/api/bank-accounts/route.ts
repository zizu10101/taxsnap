import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { findBankAccountByName, isUniqueViolation } from "@/lib/find-by-name";

// One list per account, no tier cap - see 0047 (0048 adds the bank/card type). Inactive accounts are
// returned too (is_active tells the client which to offer in pickers) so a
// payment recorded against a since-removed account still shows its label.
export async function GET() {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const { data, error } = await result.supabase
    .from("bank_accounts")
    .select("*")
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ bankAccounts: data });
}

export async function POST(request: Request) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;

  const body = await request.json();
  const name: string | undefined = body?.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "Account name is required." }, { status: 400 });
  }

  // 'bank' can receive customer payments ("Deposited to"); 'card' (credit card)
  // is only ever an expense's "Paid with". Omitted means 'bank', as before 0048.
  const rawType = body?.account_type;
  if (rawType !== undefined && rawType !== "bank" && rawType !== "card") {
    return NextResponse.json({ error: "Account type must be bank or card." }, { status: 400 });
  }
  const accountType: "bank" | "card" = rawType === "card" ? "card" : "bank";

  const duplicateMessage = `An account named "${name}" already exists.`;
  const existing = await findBankAccountByName(supabase, user.id, name);
  if (existing) {
    return NextResponse.json({ error: duplicateMessage }, { status: 409 });
  }

  const { data, error } = await supabase
    .from("bank_accounts")
    .insert({ user_id: user.id, name, account_type: accountType })
    .select()
    .single();

  if (isUniqueViolation(error)) {
    return NextResponse.json({ error: duplicateMessage }, { status: 409 });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ bankAccount: data }, { status: 201 });
}
