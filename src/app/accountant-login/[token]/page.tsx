import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  ACCOUNTANT_COOKIE,
  createServiceClient,
  lookupAccountantSession,
} from "@/lib/accountant-session";
import { ACCOUNTANT_HOME } from "@/lib/accountant-route-guard";
import { AccountantLoginForm } from "@/components/accountant-portal/accountant-login-form";

export const metadata: Metadata = {
  title: "Accountant sign in — TaxSnap",
  robots: { index: false, follow: false },
};

// Public page: the business's accountant link, resolved only by the opaque
// token. Shows the business name/logo and nothing else about the business.
export default async function AccountantLoginPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const cookieStore = await cookies();
  const existing = cookieStore.get(ACCOUNTANT_COOKIE)?.value;
  if (existing && (await lookupAccountantSession(existing))) {
    redirect(ACCOUNTANT_HOME);
  }

  const supabase = createServiceClient();

  const { data: login } = await supabase
    .from("accountant_logins")
    .select("user_id")
    .eq("link_token", token)
    .maybeSingle();
  if (!login) notFound();

  const { data: profile } = await supabase
    .from("profiles")
    .select("business_name, logo_url")
    .eq("id", login.user_id)
    .single();

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
        <h1 className="text-2xl font-bold">{profile?.business_name ?? "Accountant sign in"}</h1>
        <p className="text-sm text-muted-foreground">
          Accountant access: read-only view of this business&apos;s records.
        </p>
      </div>

      <AccountantLoginForm token={token} />
    </main>
  );
}
