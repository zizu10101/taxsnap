import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Server-side gate for the whole Commission route subtree (this page, plus
// reports/services/stylists underneath it). DashboardHeader already hides
// the nav button for a non-salon account, but that alone doesn't stop
// direct URL entry or back/forward navigation - same gap AppLockProvider
// closes for staff mode and /billing. That guard is client-only because
// app-lock role has no server-side representation; business_type is a real
// column, so this redirects before any Commission page ever renders
// instead of flashing content and correcting client-side afterward.
//
// No `if (!user) redirect("/auth")` here - same reasoning as
// (app)/layout.tsx: this isn't the auth guard, only the business-type gate,
// so a missing user just renders children and lets each page's own auth
// check redirect in one hop instead of bouncing through /dashboard first.
export default async function CommissionLayout({
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

  if (profile?.business_type !== "salon") {
    redirect("/dashboard");
  }

  return <>{children}</>;
}
