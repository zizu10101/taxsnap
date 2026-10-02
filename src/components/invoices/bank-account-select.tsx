"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBankAccounts } from "@/components/owner-lists-provider";

const NONE = "__none__";

// Optional "Deposited to" picker shared by every place a payment is recorded
// (invoice detail, contract-level payment dialog). `value` is a bank account
// id, or "" for none. Only active accounts are offered, plus the payment's
// own current account even if it has since been deactivated - editing that
// payment must keep showing (and keeping) it.
export function BankAccountSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (bankAccountId: string) => void;
}) {
  const accounts = useBankAccounts();
  const options = useMemo(
    () => accounts.filter((a) => a.is_active || a.id === value),
    [accounts, value],
  );
  // Select's trigger would show the raw id until opened once without an
  // explicit items map (see CLAUDE.md, Stack quirks).
  const items = useMemo(() => {
    const map: Record<string, string> = { [NONE]: "Not specified" };
    for (const a of options) map[a.id] = a.is_active ? a.name : `${a.name} (inactive)`;
    return map;
  }, [options]);

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Deposited to (optional)</Label>
      {options.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No bank accounts yet -{" "}
          <Link href="/dashboard/settings" className="underline underline-offset-2">
            add them in Settings
          </Link>
          .
        </p>
      ) : (
        <Select
          items={items}
          value={value || NONE}
          onValueChange={(v) => onChange(!v || v === NONE ? "" : v)}
        >
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Not specified</SelectItem>
            {options.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {items[a.id]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
