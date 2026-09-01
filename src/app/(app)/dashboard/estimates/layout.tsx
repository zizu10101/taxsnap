import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Server-side gate for the whole Estimates route subtree (this page, plus
// [id] underneath it) - mirrors commission/layout.tsx's shape but inverted:
// Estimates doesn't apply to salon accounts (DashboardHeader already hides
// the nav button for them), but that alone doesn't stop direct URL entry
// or back/forward navigation, so this redirects before any Estimates page
// ever renders instead of flashing content and correcting client-side
// afterward.
//
// No `if (!user) redirect("/auth")` here - same reasoning as
// (app)/layout.tsx: this isn't the auth guard, only the business-type gate,
// so a missing user just renders children and lets each page's own auth
// check redirect in one hop instead of bouncing through /dashboard first.
export default async function EstimatesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return <>{children}</>;

  const { data: profile } = await supabase
    .from("profiles")
    .select("business_type")
    .eq("id", user.id)
    .single();

  if (profile?.business_type === "salon") {
    redirect("/dashboard");
  }

  return <>{children}</>;
}
