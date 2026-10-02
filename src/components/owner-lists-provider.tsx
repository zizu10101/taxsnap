"use client";

import { createContext, useContext, useMemo } from "react";
import { mergeCategories } from "@/lib/expense-categories";
import type { BankAccount, ExpenseCategory } from "@/lib/database.types";

interface OwnerLists {
  bankAccounts: BankAccount[];
  customCategories: ExpenseCategory[];
}

// Fetched once by dashboard/layout.tsx so every payment form and category
// picker under /dashboard reads the owner's lists without each page
// threading them through props. The Settings sections call router.refresh()
// after a change, which re-runs that layout and updates this.
// Default (outside the provider, e.g. /employee/**) is empty: pickers just
// show the built-in categories and no bank accounts.
const OwnerListsContext = createContext<OwnerLists>({ bankAccounts: [], customCategories: [] });

export function OwnerListsProvider({
  bankAccounts,
  customCategories,
  children,
}: OwnerLists & { children: React.ReactNode }) {
  const value = useMemo(() => ({ bankAccounts, customCategories }), [bankAccounts, customCategories]);
  return <OwnerListsContext.Provider value={value}>{children}</OwnerListsContext.Provider>;
}

// Every account, active or not - lets a payment recorded against a since-
// removed account still resolve its label. Pickers should offer only the
// active ones (plus the payment's own current account).
export function useBankAccounts(): BankAccount[] {
  return useContext(OwnerListsContext).bankAccounts;
}

// Built-in categories first, then the owner's active custom ones. `current`
// (a receipt's existing category) is appended if it isn't otherwise present,
// so editing an old receipt whose custom category was later deactivated
// still shows - and keeps - its value instead of silently switching it.
export function useExpenseCategoryOptions(current?: string): string[] {
  const { customCategories } = useContext(OwnerListsContext);
  return useMemo(() => {
    const options = mergeCategories(customCategories.filter((c) => c.is_active).map((c) => c.name));
    const cur = current?.trim();
    if (cur && !options.some((o) => o.toLowerCase() === cur.toLowerCase())) options.push(cur);
    return options;
  }, [customCategories, current]);
}
