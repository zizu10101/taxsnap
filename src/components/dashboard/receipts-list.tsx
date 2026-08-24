"use client";

import { useState } from "react";
import {
  Briefcase,
  Download,
  Loader2,
  Receipt as ReceiptIcon,
  Trash2,
} from "lucide-react";
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
  onSelect,
  exportFilename,
}: {
  receipts: Receipt[];
  onDeleted: (id: string) => void;
  onSelect: (receipt: Receipt) => void;
  exportFilename: string;
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
      toast.info("No receipts in this range to export");
      return;
    }
    const csv = receiptsToCsv(receipts);
    downloadCsv(exportFilename, csv);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Receipts</CardTitle>
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </CardHeader>
      <CardContent>
        {receipts.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <ReceiptIcon className="h-8 w-8" />
            <p className="text-sm">No receipts in this date range.</p>
          </div>
        ) : (
          <ul className="divide-y">
            {receipts.map((r) => (
              <li
                key={r.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(r)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(r);
                  }
                }}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-md py-3 outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">{r.merchant_name}</p>
                    <Badge variant="secondary" className="shrink-0 text-xs">
                      {r.tax_category}
                    </Badge>
                  </div>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    {formatDate(r.transaction_date)}
                    {r.job_name && (
                      <span className="flex items-center gap-0.5 truncate">
                        <span aria-hidden>·</span>
                        <Briefcase className="h-3 w-3 shrink-0" />
                        <span className="truncate">{r.job_name}</span>
                      </span>
                    )}
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
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(r.id);
                    }}
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
