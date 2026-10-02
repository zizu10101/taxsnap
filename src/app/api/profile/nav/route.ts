import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { HIDEABLE_NAV_KEYS, sanitizeHiddenNavKeys } from "@/components/dashboard/nav-config";

// "Hide from my menu" (Settings -> Navigation). Cosmetic only: this just stores
// which tabs the owner doesn't want in their own sidebar / bottom bar. It never
// touches tier access, requireProUser, or whether a page loads by URL, and the
// records behind a hidden tab are untouched. Not Pro-gated - a display
// preference, available at every tier, same as the theme route.
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const keys: unknown = body?.hidden_nav_keys;

  // Strict on purpose: an unknown key means a bug (or a stale client), not
  // something to quietly drop - Dashboard in particular can never be hidden.
  if (
    !Array.isArray(keys) ||
    keys.some((k) => !(HIDEABLE_NAV_KEYS as readonly unknown[]).includes(k))
  ) {
    return NextResponse.json(
      { error: `hidden_nav_keys must be an array of: ${HIDEABLE_NAV_KEYS.join(", ")}.` },
      { status: 400 },
    );
  }

  const hidden = sanitizeHiddenNavKeys(keys);
  const { error } = await supabase
    .from("profiles")
    .update({ hidden_nav_keys: hidden })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ hidden_nav_keys: hidden });
}
