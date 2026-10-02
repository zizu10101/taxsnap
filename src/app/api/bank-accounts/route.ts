import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { findBankAccountByName, isUniqueViolation } from "@/lib/find-by-name";

// One list per account, no tier cap - see 0047. Inactive accounts are
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

  const duplicateMessage = `A bank account named "${name}" already exists.`;
  const existing = await findBankAccountByName(supabase, user.id, name);
  if (existing) {
    return NextResponse.json({ error: duplicateMessage }, { status: 409 });
  }

  const { data, error } = await supabase
    .from("bank_accounts")
    .insert({ user_id: user.id, name })
    .select()
    .single();

  if (isUniqueViolation(error)) {
    return NextResponse.json({ error: duplicateMessage }, { status: 409 });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ bankAccount: data }, { status: 201 });
}
