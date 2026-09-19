import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Not Pro-gated - a display preference, available at every tier, same
// as the other small per-field profile routes (business-type, logo).
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { theme_preference } = body ?? {};

  if (theme_preference !== "light" && theme_preference !== "dark" && theme_preference !== "system") {
    return NextResponse.json(
      { error: "theme_preference must be 'light', 'dark', or 'system'." },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from("profiles")
    .update({ theme_preference })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
