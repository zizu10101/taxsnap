import { createClient } from "@/lib/supabase/server";
import { AppLockProvider } from "@/components/app-lock/app-lock-provider";
import { APP_SETTINGS_PUBLIC_COLUMNS } from "@/lib/app-settings-columns";

// A route group (no "(app)" segment in the actual URL) so /dashboard/** and
// /billing/** - two separate top-level folders, not nested under each other
// - can share a single AppLockProvider instance and stay one continuous
// client-side navigation for it. Two independent providers (one per folder)
// would each mount their own lock/idle state, so crossing between the two
// sections would re-show the lock screen and forget staff-mode role every
// time - not "one gate for the whole logged-in app."
//
// The single place that needs to know whether a PIN gate should engage at
// all. Each page underneath still does its own
// `if (!user) redirect("/auth")`, so a missing user here just renders
// children as-is and lets that redirect happen; this layout isn't the auth
// guard, only the lock-screen guard.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <>{children}</>;
  }

  // No row yet means the owner has never set a PIN - has_owner_pin reads as
  // false, and AppLockProvider skips the gate entirely rather than forcing
  // PIN setup on someone who hasn't opted in.
  const { data: settings } = await supabase
    .from("app_settings")
    .select(APP_SETTINGS_PUBLIC_COLUMNS)
    .eq("user_id", user.id)
    .maybeSingle();

  return (
    <AppLockProvider hasOwnerPin={settings?.has_owner_pin ?? false}>
      {children}
    </AppLockProvider>
  );
}
