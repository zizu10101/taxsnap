import { createClient } from "@/lib/supabase/server";

// Shared guard for the Pro-only invoicing & estimates API routes: confirms
// the request is authenticated and the user is on the Pro plan, returning
// either an { error, status } pair to short-circuit with, or a ready-to-use
// Supabase client + user.
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
      error: "Invoicing and estimates are a Pro feature. Upgrade to unlock them." as const,
      status: 403 as const,
    };
  }

  return { supabase, user };
}
