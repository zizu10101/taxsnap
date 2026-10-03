import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Signed out — TaxSnap",
  robots: { index: false, follow: false },
};

// Where a signed-out accountant lands when this browser doesn't remember a
// sign-in link. Public, shows nothing about any business.
export default function AccountantSignedOutPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 text-center">
      <h1 className="text-xl font-bold">Signed out</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Open the sign-in link the business owner sent you to view their records.
      </p>
    </main>
  );
}
