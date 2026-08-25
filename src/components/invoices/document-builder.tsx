"use client";

import { useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ONTARIO_HST_RATE } from "@/lib/hst";
import type { Client, DocumentType, DocumentWithRelations } from "@/lib/database.types";

const NEW_CLIENT = "__new__";

interface LineItemDraft {
  description: string;
  quantity: number;
  unit_price: number;
}

const EMPTY_ITEM: LineItemDraft = { description: "", quantity: 1, unit_price: 0 };

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function DocumentBuilder({
  open,
  onOpenChange,
  defaultType,
  document,
  clients,
  onSaved,
  onClientCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultType: DocumentType;
  document?: DocumentWithRelations | null;
  clients: Client[];
  onSaved: (document: DocumentWithRelations) => void;
  onClientCreated: (client: Client) => void;
}) {
  const isEditing = !!document;

  const [type, setType] = useState<DocumentType>(document?.type ?? defaultType);
  const [clientId, setClientId] = useState<string>(document?.client_id ?? NEW_CLIENT);
  const [newClient, setNewClient] = useState({ name: "", email: "", address: "" });
  const [issueDate, setIssueDate] = useState(document?.issue_date ?? todayIso());
  const [dueDate, setDueDate] = useState(document?.due_date ?? "");
  const [items, setItems] = useState<LineItemDraft[]>(
    document?.items?.length
      ? document.items.map((i) => ({
          description: i.description,
          quantity: i.quantity,
          unit_price: i.unit_price,
        }))
      : [{ ...EMPTY_ITEM }],
  );
  const [saving, setSaving] = useState(false);

  // Client select's value (a uuid) never matches its displayed label (the
  // client's name), which Base UI's Select can't resolve without an
  // explicit items map - see the date range / job filters for the same fix.
  const clientSelectItems = useMemo(() => {
    const map: Record<string, string> = { [NEW_CLIENT]: "+ Add new client" };
    for (const c of clients) map[c.id] = c.name;
    return map;
  }, [clients]);

  const totals = useMemo(() => {
    const subtotal = items.reduce(
      (sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0),
      0,
    );
    const hst = subtotal * ONTARIO_HST_RATE;
    return { subtotal, hst, total: subtotal + hst };
  }, [items]);

  function updateItem(index: number, patch: Partial<LineItemDraft>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  async function handleSave() {
    if (clientId === NEW_CLIENT && !newClient.name.trim()) {
      toast.error("Select an existing client or enter a name for a new one.");
      return;
    }
    const cleanItems = items.filter((i) => i.description.trim());
    if (cleanItems.length === 0) {
      toast.error("Add at least one line item.");
      return;
    }

    setSaving(true);
    try {
      const body = {
        type,
        issue_date: issueDate,
        due_date: dueDate || null,
        client_id: clientId === NEW_CLIENT ? null : clientId,
        new_client: clientId === NEW_CLIENT ? newClient : undefined,
        items: cleanItems,
      };

      const res = await fetch(
        isEditing ? `/api/documents/${document!.id}` : "/api/documents",
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");

      const saved = data.document as DocumentWithRelations;
      if (saved.client && clientId === NEW_CLIENT) {
        onClientCreated(saved.client);
      }
      onSaved(saved);
      toast.success(isEditing ? `${type === "invoice" ? "Invoice" : "Estimate"} updated` : `${type === "invoice" ? "Invoice" : "Estimate"} created`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit" : "New"} {type === "invoice" ? "Invoice" : "Estimate"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <Tabs value={type} onValueChange={(v) => v && setType(v as DocumentType)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="estimate">Estimate</TabsTrigger>
              <TabsTrigger value="invoice">Invoice</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="space-y-2">
            <Label htmlFor="doc-client">Client</Label>
            <Select
              items={clientSelectItems}
              value={clientId}
              onValueChange={(v) => v && setClientId(v)}
            >
              <SelectTrigger id="doc-client" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NEW_CLIENT}>+ Add new client</SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {clientId === NEW_CLIENT && (
            <div className="grid gap-3 rounded-lg border p-3">
              <div className="space-y-1.5">
                <Label htmlFor="client-name">Name</Label>
                <Input
                  id="client-name"
                  value={newClient.name}
                  onChange={(e) =>
                    setNewClient({ ...newClient, name: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="client-email">Email (optional)</Label>
                <Input
                  id="client-email"
                  type="email"
                  value={newClient.email}
                  onChange={(e) =>
                    setNewClient({ ...newClient, email: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="client-address">Address (optional)</Label>
                <Input
                  id="client-address"
                  value={newClient.address}
                  onChange={(e) =>
                    setNewClient({ ...newClient, address: e.target.value })
                  }
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="issue-date">Issue date</Label>
              <Input
                id="issue-date"
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="due-date">Due date (optional)</Label>
              <Input
                id="due-date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Line items</Label>
            {items.map((item, i) => {
              const lineTotal =
                (Number(item.quantity) || 0) * (Number(item.unit_price) || 0);
              return (
                <div key={i} className="space-y-1.5 rounded-lg border p-2.5">
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Description (e.g. Potlights)"
                      className="flex-1"
                      value={item.description}
                      onChange={(e) =>
                        updateItem(i, { description: e.target.value })
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      onClick={() =>
                        setItems((prev) => prev.filter((_, idx) => idx !== i))
                      }
                      disabled={items.length === 1}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-1.5 text-sm">
                    <NumberInput
                      placeholder="Qty"
                      className="w-16"
                      value={item.quantity}
                      onValueChange={(quantity) => updateItem(i, { quantity })}
                    />
                    <span className="text-muted-foreground">×</span>
                    <NumberInput
                      placeholder="Price"
                      className="w-24"
                      value={item.unit_price}
                      onValueChange={(unit_price) =>
                        updateItem(i, { unit_price })
                      }
                    />
                    <span className="text-muted-foreground">=</span>
                    <span className="ml-auto shrink-0 font-semibold tabular-nums">
                      {formatCurrency(lineTotal)}
                    </span>
                  </div>
                </div>
              );
            })}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setItems((prev) => [...prev, { ...EMPTY_ITEM }])}
            >
              <Plus className="h-4 w-4" />
              Add line item
            </Button>
          </div>

          <div className="space-y-1.5 rounded-lg bg-muted/40 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="tabular-nums">{formatCurrency(totals.subtotal)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">HST (13%)</span>
              <span className="tabular-nums">{formatCurrency(totals.hst)}</span>
            </div>
            <div className="flex items-center justify-between font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{formatCurrency(totals.total)}</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEditing ? "Save changes" : `Create ${type === "invoice" ? "invoice" : "estimate"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
