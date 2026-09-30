import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Founder-only guard for /admin. Identity is a fixed Supabase auth user id
// from the ADMIN_USER_ID env var - deliberately NOT a column on `profiles`
// (or anything else a user can write to under RLS), so no account can grant
// itself access. Uses getUser() (server-verified against Supabase Auth), not
// getSession()/cookie claims.
//
// Signed out -> /auth. Anyone else, or ADMIN_USER_ID unset -> 404, so the
// route's existence isn't revealed. Call from every admin page/route, not
// just the layout: layouts don't re-run on every client-side navigation.
export async function requireAdmin() {
  const adminId = process.env.ADMIN_USER_ID;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth?redirectTo=/admin");
  if (!adminId || user.id !== adminId) notFound();

  return user;
}
