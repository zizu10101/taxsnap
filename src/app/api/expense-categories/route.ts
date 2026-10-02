import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";
import { findExpenseCategoryByName, isUniqueViolation } from "@/lib/find-by-name";
import { isDefaultCategory } from "@/lib/expense-categories";

export async function GET() {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const { data, error } = await result.supabase
    .from("expense_categories")
    .select("*")
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ categories: data });
}

// Owner-added categories sit alongside the fixed TAX_CATEGORIES list, so a
// name that matches a default (case-insensitively) is rejected - it would be
// a second, confusingly identical entry in every picker.
export async function POST(request: Request) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;

  const body = await request.json();
  const name: string | undefined = body?.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "Category name is required." }, { status: 400 });
  }
  if (isDefaultCategory(name)) {
    return NextResponse.json(
      { error: `"${name}" is already one of the built-in categories.` },
      { status: 409 },
    );
  }

  const duplicateMessage = `A category named "${name}" already exists.`;
  if (await findExpenseCategoryByName(supabase, user.id, name)) {
    return NextResponse.json({ error: duplicateMessage }, { status: 409 });
  }

  const { data, error } = await supabase
    .from("expense_categories")
    .insert({ user_id: user.id, name })
    .select()
    .single();

  if (isUniqueViolation(error)) {
    return NextResponse.json({ error: duplicateMessage }, { status: 409 });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ category: data }, { status: 201 });
}
