import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { AFTER_ONBOARDING, goalsFor, parseGoals } from "@/lib/onboarding";

// Onboarding step 2: stores the chosen goals (a list, at least one) and marks
// onboarding done. Not Pro-gated - the flow must always be finishable on any
// plan. The goals are validated against what this account is offered. The first
// goal is also written to the old single onboarding_goal column so a rollback of
// 0066 loses nothing.
export async function POST(request: Request) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;

  const body = await request.json().catch(() => null);
  const { data: profile } = await supabase
    .from("profiles")
    .select("business_type")
    .eq("id", user.id)
    .single();

  // A general account is offered three goals, a salon account four.
  const offered = goalsFor(profile?.business_type ?? "general").map((g) => g.value);
  const goals = parseGoals(body?.goals, offered);
  if (!goals) {
    return NextResponse.json({ error: "Pick at least one thing you want to do." }, { status: 400 });
  }

  const { error } = await supabase
    .from("profiles")
    .update({ onboarding_completed: true, onboarding_goals: goals, onboarding_goal: goals[0] })
    .eq("id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, next: AFTER_ONBOARDING });
}
