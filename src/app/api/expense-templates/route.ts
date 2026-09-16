import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { wouldExceedTotalLimit, limitReachedMessage } from "@/lib/plan-limits";
import { resolveJobIdByName } from "@/lib/resolve-job";

const RECURRENCE_HINTS = ["weekly", "monthly", "quarterly", "yearly"];

export async function GET() {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // Joined job name so the template picker can pre-fill the manual
  // expense form's job Select (which works off job names, same pattern
  // as every other job picker in the app) without a second lookup.
  const { data, error } = await result.supabase
    .from("expense_templates")
    .select("*, job:jobs(name)")
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ templates: data });
}

export async function POST(request: Request) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;

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

  const totalCheck = await wouldExceedTotalLimit(supabase, user.id, "expenseTemplates");
  if (totalCheck.exceeded) {
    return NextResponse.json(
      { error: limitReachedMessage(totalCheck, "expense template"), code: "FREE_LIMIT_REACHED" },
      { status: 403 },
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
    .insert({
      user_id: user.id,
      name: name.trim(),
      description: description.trim(),
      default_amount: Number(default_amount) || 0,
      default_tax_amount: Number(default_tax_amount) || 0,
      default_tax_category: default_tax_category || "Other",
      job_id: jobId,
      recurrence_hint: RECURRENCE_HINTS.includes(recurrence_hint) ? recurrence_hint : null,
    })
    .select("*, job:jobs(name)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ template: data }, { status: 201 });
}
