import type { Metadata } from "next";
import { AccountantExpensesView } from "@/components/accountant-portal/accountant-expenses-view";
import { getAccountantPageContext } from "@/lib/accountant-page";
import {
  listAccountantBankAccounts,
  listAccountantExpenses,
} from "@/lib/accountant-portal-server";

export const metadata: Metadata = {
  title: "Expenses — Accountant access — TaxSnap",
};

export default async function AccountantExpensesPage() {
  const ctx = await getAccountantPageContext();
  if (!ctx.available) return null;

  const [receipts, accounts] = await Promise.all([
    listAccountantExpenses(ctx.db),
    listAccountantBankAccounts(ctx.db),
  ]);

  return <AccountantExpensesView receipts={receipts} accounts={accounts} />;
}
