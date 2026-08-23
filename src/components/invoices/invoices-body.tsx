"use client";

import { useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Invoice, InvoiceLineItem, InvoiceStatus } from "@/lib/database.types";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

const STATUS_VARIANT: Record<InvoiceStatus, "outline" | "secondary" | "default"> = {
  draft: "outline",
  sent: "secondary",
  paid: "default",
};

const EMPTY_LINE_ITEM: InvoiceLineItem = {
  description: "",
  quantity: 1,
  unit_price: 0,
};

export function InvoicesBody({ initialInvoices }: { initialInvoices: Invoice[] }) {
  const [invoices, setInvoices] = useState(initialInvoices);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [lineItems, setLineItems] = useState<InvoiceLineItem[]>([
    { ...EMPTY_LINE_ITEM },
  ]);

  const total = lineItems.reduce(
    (sum, item) => sum + item.quantity * item.unit_price,
    0,
  );

  function updateLineItem(index: number, patch: Partial<InvoiceLineItem>) {
    setLineItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }

  function resetForm() {
    setClientName("");
    setClientEmail("");
    setLineItems([{ ...EMPTY_LINE_ITEM }]);
  }

  async function handleCreate() {
    setSaving(true);
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: clientName,
          client_email: clientEmail || undefined,
          line_items: lineItems.filter((li) => li.description.trim()),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create invoice");

      setInvoices((prev) => [data.invoice as Invoice, ...prev]);
      toast.success("Invoice created");
      resetForm();
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(id: string, status: InvoiceStatus) {
    const previous = invoices;
    setInvoices((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)));
    try {
      const res = await fetch(`/api/invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed to update status");
    } catch {
      setInvoices(previous);
      toast.error("Failed to update invoice status");
    }
  }

  async function handleDelete(id: string) {
    const previous = invoices;
    setInvoices((prev) => prev.filter((i) => i.id !== id));
    try {
      const res = await fetch(`/api/invoices/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete invoice");
    } catch {
      setInvoices(previous);
      toast.error("Failed to delete invoice");
    }
  }

  return (
    <div className="space-y-4">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button className="w-full" />}>
          <Plus className="h-4 w-4" />
          New invoice
        </DialogTrigger>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New invoice</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="space-y-2">
              <Label htmlFor="client_name">Client name</Label>
              <Input
                id="client_name"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="client_email">Client email (optional)</Label>
              <Input
                id="client_email"
                type="email"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Line items</Label>
              {lineItems.map((item, i) => (
                <div key={i} className="flex items-end gap-2">
                  <Input
                    placeholder="Description"
                    className="flex-1"
                    value={item.description}
                    onChange={(e) =>
                      updateLineItem(i, { description: e.target.value })
                    }
                  />
                  <Input
                    type="number"
                    placeholder="Qty"
                    className="w-16"
                    value={item.quantity}
                    onChange={(e) =>
                      updateLineItem(i, {
                        quantity: parseFloat(e.target.value) || 0,
                      })
                    }
                  />
                  <Input
                    type="number"
                    placeholder="Price"
                    className="w-24"
                    value={item.unit_price}
                    onChange={(e) =>
                      updateLineItem(i, {
                        unit_price: parseFloat(e.target.value) || 0,
                      })
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() =>
                      setLineItems((prev) => prev.filter((_, idx) => idx !== i))
                    }
                    disabled={lineItems.length === 1}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setLineItems((prev) => [...prev, { ...EMPTY_LINE_ITEM }])
                }
              >
                <Plus className="h-4 w-4" />
                Add line item
              </Button>
            </div>

            <p className="text-right text-lg font-semibold">
              Total: {formatCurrency(total)}
            </p>
          </div>

          <DialogFooter>
            <Button
              onClick={handleCreate}
              disabled={saving || !clientName || total <= 0}
              className="w-full"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Create invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {invoices.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No invoices yet. Create your first one above.
        </p>
      ) : (
        <div className="space-y-3">
          {invoices.map((inv) => (
            <Card key={inv.id}>
              <CardHeader className="flex flex-row items-start justify-between pb-2">
                <div>
                  <CardTitle className="text-base">{inv.client_name}</CardTitle>
                  {inv.client_email && (
                    <p className="text-xs text-muted-foreground">
                      {inv.client_email}
                    </p>
                  )}
                </div>
                <Badge variant={STATUS_VARIANT[inv.status]}>{inv.status}</Badge>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-3">
                <span className="text-lg font-semibold tabular-nums">
                  {formatCurrency(inv.total_amount)}
                </span>
                <div className="flex items-center gap-2">
                  <Select
                    value={inv.status}
                    onValueChange={(v) =>
                      handleStatusChange(inv.id, v as InvoiceStatus)
                    }
                  >
                    <SelectTrigger className="h-8 w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="sent">Sent</SelectItem>
                      <SelectItem value="paid">Paid</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(inv.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
