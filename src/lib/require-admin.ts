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

// Route-handler variant of requireAdmin: same identity check, but returns
// { error, status } for the caller to short-circuit with (JSON, per this
// app's API convention) instead of throwing redirect()/notFound(). Every
// non-admin - including a signed-in one - gets the same 404, so /api/admin
// doesn't reveal itself either.
export async function assertAdmin() {
  const adminId = process.env.ADMIN_USER_ID;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !adminId || user.id !== adminId) {
    return { error: "Not found" as const, status: 404 as const };
  }

  return { user };
}
