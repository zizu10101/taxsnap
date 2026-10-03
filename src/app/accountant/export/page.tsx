import type { Metadata } from "next";
import { AccountantExportView } from "@/components/accountant-portal/accountant-export-view";
import { getAccountantPageContext } from "@/lib/accountant-page";

export const metadata: Metadata = {
  title: "Export — Accountant access — TaxSnap",
};

export default async function AccountantExportPage() {
  const ctx = await getAccountantPageContext();
  if (!ctx.available) return null;

  return <AccountantExportView businessName={ctx.businessName} />;
}
