import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { AFTER_ONBOARDING, goalsFor, parseGoals } from "@/lib/onboarding";
import { HIDEABLE_NAV_KEYS, sanitizeHiddenNavKeys } from "@/components/dashboard/nav-config";
import { PRO_ONLY_MENU_KEYS } from "@/lib/menu-customize";

// Onboarding's last step: stores the chosen goals (a list, at least one) and marks
// onboarding done. Step 3 ("Customize menu") may send hidden_nav_keys with it;
// leaving it out (Skip) saves nothing, so every tab stays shown. Not Pro-gated - the flow must always be finishable on any
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
    .select("business_type, subscription_status")
    .eq("id", user.id)
    .single();

  // A general account is offered three goals, a salon account four.
  const offered = goalsFor(profile?.business_type ?? "general").map((g) => g.value);
  const goals = parseGoals(body?.goals, offered);
  if (!goals) {
    return NextResponse.json({ error: "Pick at least one thing you want to do." }, { status: 400 });
  }

  const update: {
    onboarding_completed: boolean;
    onboarding_goals: string[];
    onboarding_goal: string;
    hidden_nav_keys?: string[];
  } = { onboarding_completed: true, onboarding_goals: goals, onboarding_goal: goals[0] };

  // Cosmetic menu choice from step 3. Strict like PATCH /api/profile/nav, and a
  // salon's fixed menu or a free account's Pro tabs are never stored as hidden.
  if (body?.hidden_nav_keys !== undefined) {
    const keys: unknown = body.hidden_nav_keys;
    if (
      !Array.isArray(keys) ||
      keys.some((k) => !(HIDEABLE_NAV_KEYS as readonly unknown[]).includes(k))
    ) {
      return NextResponse.json({ error: "Invalid menu choice." }, { status: 400 });
    }
    if (profile?.business_type !== "salon") {
      const isPro = profile?.subscription_status === "pro";
      update.hidden_nav_keys = sanitizeHiddenNavKeys(keys).filter(
        (k) => isPro || !PRO_ONLY_MENU_KEYS.includes(k),
      );
    }
  }

  const { error } = await supabase
    .from("profiles")
    .update(update)
    .eq("id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, next: AFTER_ONBOARDING });
}
