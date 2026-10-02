import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";
import { findExpenseCategoryByName, isUniqueViolation } from "@/lib/find-by-name";
import { isDefaultCategory } from "@/lib/expense-categories";

// Rename (cascaded onto receipts/templates by rename_expense_category, one
// transaction) and/or deactivate/reactivate. No DELETE: a category with
// history stays on those receipts and in reports; is_active=false just
// hides it from the pickers.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;
  const { id } = await params;

  const body = await request.json();
  const hasName = body?.name !== undefined;
  const hasActive = body?.is_active !== undefined;
  if (!hasName && !hasActive) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const { data: current } = await supabase
    .from("expense_categories")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!current) {
    return NextResponse.json({ error: "Category not found." }, { status: 404 });
  }

  let category = current;

  if (hasName) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "Category name is required." }, { status: 400 });
    }
    if (name !== current.name) {
      if (isDefaultCategory(name)) {
        return NextResponse.json(
          { error: `"${name}" is already one of the built-in categories.` },
          { status: 409 },
        );
      }
      const duplicateMessage = `A category named "${name}" already exists.`;
      if (await findExpenseCategoryByName(supabase, user.id, name, id)) {
        return NextResponse.json({ error: duplicateMessage }, { status: 409 });
      }
      const { data, error } = await supabase.rpc("rename_expense_category", {
        p_id: id,
        p_new_name: name,
      });
      if (isUniqueViolation(error)) {
        return NextResponse.json({ error: duplicateMessage }, { status: 409 });
      }
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      category = data;
    }
  }

  if (hasActive) {
    const { data, error } = await supabase
      .from("expense_categories")
      .update({ is_active: !!body.is_active })
      .eq("id", id)
      .eq("user_id", user.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    category = data;
  }

  return NextResponse.json({ category });
}
