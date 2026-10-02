"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Landmark, Loader2, Pencil, Plus, Tags, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TAX_CATEGORIES } from "@/lib/tax-categories";
import type { BankAccount, ExpenseCategory } from "@/lib/database.types";

interface ListItem {
  id: string;
  name: string;
  is_active: boolean;
}

// Shared add / rename / remove list for the two owner-managed lists. "Remove"
// deactivates (is_active = false) rather than deleting - payments and
// receipts keep pointing at the item, so history and reports keep their label
// - and an inactive row can be restored. `endpoint` is the collection route
// ("/api/bank-accounts"); `itemKey` is the key the API wraps a single row in.
function ManagedNameList({
  endpoint,
  itemKey,
  noun,
  initialItems,
  placeholder,
}: {
  endpoint: string;
  itemKey: "bankAccount" | "category";
  noun: string;
  initialItems: ListItem[];
  placeholder: string;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
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
      const created = await request(endpoint, "POST", { name: newName });
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
                      if (e.key === "Enter") patchItem(item.id, { name: editName }, "Renamed");
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="h-8"
                  />
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      title="Save"
                      disabled={busyId === item.id || !editName.trim()}
                      onClick={() => patchItem(item.id, { name: editName }, "Renamed")}
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
                    {!item.is_active && <Badge variant="outline">Inactive</Badge>}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingId(item.id);
                        setEditName(item.name);
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

export function BankAccountsSettings({ initialAccounts }: { initialAccounts: BankAccount[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Landmark className="h-4 w-4" />
          Bank accounts
        </CardTitle>
        <CardDescription>
          Add the accounts you get paid into (e.g. &quot;Business Checking&quot;, &quot;Visa Ending
          1234&quot;). You can pick one under &quot;Deposited to&quot; when recording a payment.
          Removing an account hides it from that list but keeps it on payments already recorded.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ManagedNameList
          endpoint="/api/bank-accounts"
          itemKey="bankAccount"
          noun="bank accounts"
          initialItems={initialAccounts}
          placeholder="e.g. Business Checking"
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
