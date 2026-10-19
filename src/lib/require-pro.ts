import { createClient } from "@/lib/supabase/server";

// Auth-only guard (no subscription check) for API routes that are usable
// on every tier - the Commission logging/edit-trail routes, and the
// services/stylists routes that now give free-tier salon accounts a
// capped preview (see lib/plan-limits.ts) rather than being fully
// Pro-gated like the rest of Commission still is.
export const PRO_REQUIRED_CODE = "PRO_REQUIRED" as const;
export const PRO_REQUIRED_MESSAGE = "This is a Pro feature. Upgrade to Pro to unlock it." as const;

export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Unauthorized" as const, status: 401 as const };
  }

  return { supabase, user };
}

// Shared guard for the Pro-only API routes (reports, overview, progress
// billing, portals, payouts, custom categories...): confirms the request is
// authenticated and the user is on the Pro plan, returning either an
// { error, status, code } triple to short-circuit with, or a ready-to-use
// Supabase client + user. Every Pro-only screen is ALSO locked in the UI
// (UpgradeCard), but this is the real enforcement.
export async function requireProUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Unauthorized" as const, status: 401 as const };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_status")
    .eq("id", user.id)
    .single();

  if (profile?.subscription_status !== "pro") {
    return {
      error: PRO_REQUIRED_MESSAGE,
      status: 403 as const,
      code: PRO_REQUIRED_CODE,
    };
  }

  return { supabase, user };
}

// Same check as requireProUser for a route that is open to everyone but has
// one Pro-only part (e.g. a job PATCH that starts progress billing).
export async function isProUser(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<boolean> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_status")
    .eq("id", userId)
    .single();
  return profile?.subscription_status === "pro";
}
