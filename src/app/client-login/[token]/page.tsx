import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  CLIENT_COOKIE,
  createServiceClient,
  lookupClientSession,
} from "@/lib/client-session";
import { CLIENT_HOME } from "@/lib/client-route-guard";
import { ClientLoginForm } from "@/components/client-portal/client-login-form";

export const metadata: Metadata = {
  title: "Client sign in — TaxSnap",
  robots: { index: false, follow: false },
};

// Public page: one link per client. Resolved only by the opaque token. Shows
// the business name/logo and the client's own name - nothing else.
export default async function ClientLoginPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const cookieStore = await cookies();
  const existing = cookieStore.get(CLIENT_COOKIE)?.value;
  if (existing && (await lookupClientSession(existing))) {
    redirect(CLIENT_HOME);
  }

  const supabase = createServiceClient();

  const { data: login } = await supabase
    .from("client_portal_logins")
    .select("client_id, user_id")
    .eq("link_token", token)
    .maybeSingle();
  if (!login) notFound();

  const [{ data: profile }, { data: client }] = await Promise.all([
    supabase
      .from("profiles")
      .select("business_name, logo_url")
      .eq("id", login.user_id)
      .single(),
    supabase.from("clients").select("name").eq("id", login.client_id).single(),
  ]);

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
        <h1 className="text-2xl font-bold">{profile?.business_name ?? "Client portal"}</h1>
        <p className="text-sm text-muted-foreground">
          {client?.name ? `Signing in as ${client.name}` : "Sign in to view your documents."}
        </p>
      </div>

      <ClientLoginForm token={token} />
    </main>
  );
}
