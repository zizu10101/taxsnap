import type { Metadata } from "next";
import { AccountantDocumentsView } from "@/components/accountant-portal/accountant-documents-view";
import { getAccountantPageContext } from "@/lib/accountant-page";
import { listAccountantDocuments } from "@/lib/accountant-portal-server";

export const metadata: Metadata = {
  title: "Invoices & estimates — Accountant access — TaxSnap",
};

export default async function AccountantInvoicesPage() {
  const ctx = await getAccountantPageContext();
  if (!ctx.available) return null;

  return <AccountantDocumentsView documents={await listAccountantDocuments(ctx.db)} />;
}
