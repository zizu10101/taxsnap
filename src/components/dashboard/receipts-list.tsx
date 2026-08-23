"use client";

import { useState } from "react";
import { Download, Loader2, Receipt as ReceiptIcon, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { downloadCsv, receiptsToCsv } from "@/lib/csv";
import type { Receipt } from "@/lib/database.types";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatDate(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ReceiptsList({
  receipts,
  onDeleted,
}: {
  receipts: Receipt[];
  onDeleted: (id: string) => void;
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/receipts/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete receipt");
      }
      onDeleted(id);
      toast.success("Receipt deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setDeletingId(null);
    }
  }

  function handleExport() {
    if (receipts.length === 0) {
      toast.info("No receipts to export yet");
      return;
    }
    const csv = receiptsToCsv(receipts);
    const filename = `taxsnap-receipts-${new Date().toISOString().slice(0, 10)}.csv`;
    downloadCsv(filename, csv);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Recent receipts</CardTitle>
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </CardHeader>
      <CardContent>
        {receipts.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <ReceiptIcon className="h-8 w-8" />
            <p className="text-sm">
              No receipts yet. Snap your first one to get started.
            </p>
          </div>
        ) : (
          <ul className="divide-y">
            {receipts.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">{r.merchant_name}</p>
                    <Badge variant="secondary" className="shrink-0 text-xs">
                      {r.tax_category}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(r.transaction_date)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold tabular-nums">
                    {formatCurrency(r.total_amount)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(r.id)}
                    disabled={deletingId === r.id}
                  >
                    {deletingId === r.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
