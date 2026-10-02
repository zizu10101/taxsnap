"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Landmark, Loader2, Pencil, Plus, Tags, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ACCOUNT_TYPE_LABELS, accountTypeOf, type AccountType } from "@/lib/accounts";
import { TAX_CATEGORIES } from "@/lib/tax-categories";
import type { BankAccount, ExpenseCategory } from "@/lib/database.types";

interface ListItem {
  id: string;
  name: string;
  is_active: boolean;
  // Only the accounts list has a type (bank / credit card) - see 0048.
  account_type?: AccountType | null;
}

// Shared add / rename / remove list for the two owner-managed lists. "Remove"
// deactivates (is_active = false) rather than deleting - payments and
// receipts keep pointing at the item, so history and reports keep their label
// - and an inactive row can be restored. `endpoint` is the collection route
// ("/api/bank-accounts"); `itemKey` is the key the API wraps a single row in.
// `typed` adds the bank/card chooser (on add and edit) and a type badge.
function ManagedNameList({
  endpoint,
  itemKey,
  noun,
  initialItems,
  placeholder,
  typed = false,
}: {
  endpoint: string;
  itemKey: "bankAccount" | "category";
  noun: string;
  initialItems: ListItem[];
  placeholder: string;
  typed?: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<AccountType>("bank");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState<AccountType>("bank");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function sorted(list: ListItem[]) {
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }

  async function request(url: string, method: "POST" | "PATCH", body: object) {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong");
    return data[itemKey] as ListItem;
  }

  async function handleAdd() {
    if (!newName.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const created = await request(endpoint, "POST", {
        name: newName,
        ...(typed && { account_type: newType }),
      });
      setItems((prev) => sorted([...prev, created]));
      setNewName("");
      router.refresh();
    } catch (err) {
      // Inline as well as a toast - the message is about the field in front of the user.
      const message = err instanceof Error ? err.message : "Something went wrong";
      setError(message);
      toast.error(message);
    } finally {
      setAdding(false);
    }
  }

  async function patchItem(id: string, body: object, success: string) {
    setBusyId(id);
    setError(null);
    try {
      const updated = await request(`${endpoint}/${id}`, "PATCH", body);
      setItems((prev) => sorted(prev.map((i) => (i.id === id ? updated : i))));
      setEditingId(null);
      toast.success(success);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setError(message);
      toast.error(message);
    } finally {
      setBusyId(null);
    }
  }

  function saveEdit(id: string) {
    patchItem(id, { name: editName, ...(typed && { account_type: editType }) }, "Saved");
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          value={newName}
          placeholder={placeholder}
          onChange={(e) => {
            setNewName(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
        />
        {typed && <TypeSelect id="new-account-type" value={newType} onChange={setNewType} />}
        <Button onClick={handleAdd} disabled={adding || !newName.trim()}>
          {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No {noun} yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2 p-2.5">
              {editingId === item.id ? (
                <>
                  <Input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEdit(item.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="h-8"
                  />
                  {typed && (
                    <TypeSelect
                      id={`account-type-${item.id}`}
                      value={editType}
                      onChange={setEditType}
                      compact
                    />
                  )}
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      title="Save"
                      disabled={busyId === item.id || !editName.trim()}
                      onClick={() => saveEdit(item.id)}
                    >
                      {busyId === item.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      title="Cancel"
                      onClick={() => setEditingId(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={`truncate text-sm ${item.is_active ? "" : "text-muted-foreground"}`}>
                      {item.name}
                    </span>
                    {typed && (
                      <Badge variant="secondary">{ACCOUNT_TYPE_LABELS[accountTypeOf(item)]}</Badge>
                    )}
                    {!item.is_active && <Badge variant="outline">Inactive</Badge>}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingId(item.id);
                        setEditName(item.name);
                        setEditType(accountTypeOf(item));
                        setError(null);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyId === item.id}
                      onClick={() =>
                        patchItem(
                          item.id,
                          { is_active: !item.is_active },
                          item.is_active ? "Removed" : "Restored",
                        )
                      }
                    >
                      {item.is_active ? (
                        <>
                          <X className="h-3.5 w-3.5" />
                          Remove
                        </>
                      ) : (
                        <>
                          <Undo2 className="h-3.5 w-3.5" />
                          Restore
                        </>
                      )}
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Select needs an explicit items map (value "bank" vs label "Bank account" -
// see CLAUDE.md, Stack quirks).
function TypeSelect({
  id,
  value,
  onChange,
  compact,
}: {
  id: string;
  value: AccountType;
  onChange: (value: AccountType) => void;
  compact?: boolean;
}) {
  return (
    <Select
      items={ACCOUNT_TYPE_LABELS}
      value={value}
      onValueChange={(v) => v && onChange(v as AccountType)}
    >
      <SelectTrigger id={id} aria-label="Account type" className={compact ? "h-8 w-36" : "w-36"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="bank">{ACCOUNT_TYPE_LABELS.bank}</SelectItem>
        <SelectItem value="card">{ACCOUNT_TYPE_LABELS.card}</SelectItem>
      </SelectContent>
    </Select>
  );
}

export function BankAccountsSettings({ initialAccounts }: { initialAccounts: BankAccount[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Landmark className="h-4 w-4" />
          Accounts
        </CardTitle>
        <CardDescription>
          Your bank accounts and credit cards, set up once. Bank accounts can be picked under
          &quot;Deposited to&quot; when recording a payment, and any account under &quot;Paid
          with&quot; on an expense. A credit card can&apos;t receive a payment, so it only shows
          up under &quot;Paid with&quot;. Removing an account hides it from those lists but keeps
          it on past payments and expenses.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ManagedNameList
          endpoint="/api/bank-accounts"
          itemKey="bankAccount"
          noun="accounts"
          initialItems={initialAccounts}
          placeholder="e.g. Business Checking or Visa 1234"
          typed
        />
      </CardContent>
    </Card>
  );
}

export function ExpenseCategoriesSettings({
  initialCategories,
}: {
  initialCategories: ExpenseCategory[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Tags className="h-4 w-4" />
          Expense categories
        </CardTitle>
        <CardDescription>
          Your own categories show up next to the built-in ones when you log an expense. Custom
          categories are treated as fully deductible. Renaming one updates the expenses already
          using it; removing one hides it from the list but keeps it on past expenses and reports.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ManagedNameList
          endpoint="/api/expense-categories"
          itemKey="category"
          noun="custom categories"
          initialItems={initialCategories}
          placeholder="e.g. Subcontractors"
        />
        <p className="text-xs text-muted-foreground">
          Built-in: {TAX_CATEGORIES.join(", ")}.
        </p>
      </CardContent>
    </Card>
  );
}
