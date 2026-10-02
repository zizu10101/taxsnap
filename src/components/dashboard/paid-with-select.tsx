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
import { accountDisplayName, paidWithAccounts } from "@/lib/accounts";

const NONE = "__none__";

// Optional "Paid with" picker for an expense, from the same owner-managed list
// as a payment's "Deposited to" (Settings -> Accounts) - but offering every
// active account, bank or credit card, since either can pay for something.
// `value` is an account id, or "" for none. The expense's own current account
// is kept in the options even if it was since deactivated, so editing an old
// expense keeps showing - and keeping - it.
export function PaidWithSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (accountId: string) => void;
}) {
  const accounts = useBankAccounts();
  const options = useMemo(() => paidWithAccounts(accounts, value), [accounts, value]);
  // Select's trigger would show the raw id until opened once without an
  // explicit items map (see CLAUDE.md, Stack quirks).
  const items = useMemo(() => {
    const map: Record<string, string> = { [NONE]: "Not specified" };
    for (const a of options) map[a.id] = accountDisplayName(a, { withType: true });
    return map;
  }, [options]);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Paid with (optional)</Label>
      {options.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No accounts yet -{" "}
          <Link href="/dashboard/settings" className="underline underline-offset-2">
            add your cards and accounts in Settings
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
