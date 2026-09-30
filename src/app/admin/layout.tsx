import type { Metadata } from "next";
import Link from "next/link";
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
          <Link href="/admin" className="font-heading text-xl font-bold">
            Admin
          </Link>
          <Link href="/admin/log" className="text-sm text-muted-foreground hover:underline">
            Action log
          </Link>
        </div>
        {children}
      </div>
    </div>
  );
}
