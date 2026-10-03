import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { AccountantShell } from "@/components/accountant-portal/accountant-shell";
import { getAccountantPageContext } from "@/lib/accountant-page";

export const metadata: Metadata = {
  title: "Accountant access — TaxSnap",
  robots: { index: false, follow: false },
};

// Always fresh: these are live financial records, never a cached render.
export const dynamic = "force-dynamic";

export default async function AccountantLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAccountantPageContext();

  return (
    <AccountantShell businessName={ctx.businessName} showNav={ctx.available}>
      {ctx.available ? (
        children
      ) : (
        <Card>
          <CardContent className="space-y-2 py-10 text-center">
            <p className="font-medium">Accountant access isn&apos;t available right now</p>
            <p className="text-sm text-muted-foreground">
              Ask the business owner to check their plan. Nothing has been removed, and access
              returns as soon as it is sorted out.
            </p>
          </CardContent>
        </Card>
      )}
    </AccountantShell>
  );
}
