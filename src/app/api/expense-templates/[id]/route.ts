import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { resolveJobIdByName } from "@/lib/resolve-job";

const RECURRENCE_HINTS = ["weekly", "monthly", "quarterly", "yearly"];

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
  const {
    name,
    description,
    default_amount,
    default_tax_amount,
    default_tax_category,
    job_name,
    recurrence_hint,
  } = body ?? {};

  if (!name?.trim() || !description?.trim()) {
    return NextResponse.json(
      { error: "A template name and description are required." },
      { status: 400 },
    );
  }

  let jobId: string | null;
  try {
    jobId = await resolveJobIdByName(supabase, user.id, job_name);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to resolve job";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("expense_templates")
    .update({
      name: name.trim(),
      description: description.trim(),
      default_amount: Number(default_amount) || 0,
      default_tax_amount: Number(default_tax_amount) || 0,
      default_tax_category: default_tax_category || "Other",
      job_id: jobId,
      recurrence_hint: RECURRENCE_HINTS.includes(recurrence_hint) ? recurrence_hint : null,
    })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*, job:jobs(name)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ template: data });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;
  const { id } = await params;

  const { error } = await supabase
    .from("expense_templates")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
