import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  CLIENT_COOKIE,
  CLIENT_LINK_COOKIE,
  createServiceClient,
  lookupClientSession,
} from "@/lib/client-session";
import { listPortalDocuments, loadPortalBusiness } from "@/lib/client-portal-server";
import { ClientDocumentsView } from "@/components/client-portal/client-documents-view";

export const metadata: Metadata = {
  title: "Your documents — TaxSnap",
  robots: { index: false, follow: false },
};

// Always fresh: the balance must never be a cached render.
export const dynamic = "force-dynamic";

export default async function ClientDocumentsPage() {
  const cookieStore = await cookies();
  const raw = cookieStore.get(CLIENT_COOKIE)?.value;
  const session = raw ? await lookupClientSession(raw) : null;

  if (!session) {
    const linkToken = cookieStore.get(CLIENT_LINK_COOKIE)?.value;
    if (linkToken) redirect(`/client-login/${linkToken}`);
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 text-center">
        <h1 className="text-xl font-bold">Signed out</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Open the link your contractor sent you to view your documents.
        </p>
      </main>
    );
  }

  const supabase = createServiceClient();
  const [documents, { business }] = await Promise.all([
    listPortalDocuments(supabase, session),
    loadPortalBusiness(supabase, session),
  ]);

  return (
    <ClientDocumentsView
      clientName={session.clientName}
      businessName={business.name}
      contact={{ email: business.email, phone: business.phone }}
      documents={documents}
    />
  );
}
