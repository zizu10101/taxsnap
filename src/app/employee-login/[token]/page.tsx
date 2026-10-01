import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  EMPLOYEE_COOKIE,
  createServiceClient,
  lookupEmployeeSession,
} from "@/lib/employee-session";
import { EMPLOYEE_HOME } from "@/lib/employee-route-guard";
import { EmployeeLoginForm } from "@/components/employee-portal/employee-login-form";

export const metadata: Metadata = {
  title: "Employee sign in — TaxSnap",
  robots: { index: false, follow: false },
};

// Public page: the shared per-business link. Resolved only by the opaque
// token, same pattern as /sign/[token]. Shows just the business name/logo and
// the names of employees who have a PIN - nothing else about the business.
export default async function EmployeeLoginPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const cookieStore = await cookies();
  const existing = cookieStore.get(EMPLOYEE_COOKIE)?.value;
  if (existing && (await lookupEmployeeSession(existing))) {
    redirect(EMPLOYEE_HOME);
  }

  const supabase = createServiceClient();

  const { data: settings } = await supabase
    .from("app_settings")
    .select("user_id")
    .eq("employee_login_token", token)
    .maybeSingle();
  if (!settings) notFound();

  const [{ data: profile }, { data: pins }] = await Promise.all([
    supabase
      .from("profiles")
      .select("business_name, logo_url")
      .eq("id", settings.user_id)
      .single(),
    supabase
      .from("employee_pins")
      .select("employee_id")
      .eq("user_id", settings.user_id),
  ]);

  const pinnedIds = (pins ?? []).map((p) => p.employee_id);
  const { data: employees } = pinnedIds.length
    ? await supabase
        .from("employees")
        .select("id, name")
        .eq("user_id", settings.user_id)
        .eq("is_active", true)
        .in("id", pinnedIds)
        .order("name", { ascending: true })
    : { data: [] };

  let logoUrl: string | null = null;
  if (profile?.logo_url) {
    const { data: signed } = await supabase.storage
      .from("logos")
      .createSignedUrl(profile.logo_url, 60 * 60);
    logoUrl = signed?.signedUrl ?? null;
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <div className="flex flex-col items-center gap-3 text-center">
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="max-h-20 w-auto max-w-[200px] object-contain" />
        )}
        <h1 className="text-2xl font-bold">{profile?.business_name ?? "Employee sign in"}</h1>
        <p className="text-sm text-muted-foreground">Sign in to clock in and out.</p>
      </div>

      <EmployeeLoginForm token={token} employees={employees ?? []} />
    </main>
  );
}
