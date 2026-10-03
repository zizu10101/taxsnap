import type { Metadata } from "next";
import { AccountantHoursView } from "@/components/accountant-portal/accountant-hours-view";
import { getAccountantPageContext } from "@/lib/accountant-page";
import { listAccountantHours } from "@/lib/accountant-portal-server";

export const metadata: Metadata = {
  title: "Hours — Accountant access — TaxSnap",
};

export default async function AccountantHoursPage() {
  const ctx = await getAccountantPageContext();
  if (!ctx.available) return null;

  return <AccountantHoursView entries={await listAccountantHours(ctx.db)} />;
}
