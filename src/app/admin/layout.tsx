import type { Metadata } from "next";
import { requireAdmin } from "@/lib/require-admin";

export const metadata: Metadata = {
  title: "Admin — TaxSnap",
  robots: { index: false, follow: false },
};

// Always per-request: gated on the signed-in user, never cacheable.
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-8">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <h1 className="font-heading text-xl font-bold">Admin</h1>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Read-only
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
