"use client";

import { useState } from "react";
import { UploadReceipt } from "@/components/dashboard/upload-receipt";
import { MonthlySummary } from "@/components/dashboard/monthly-summary";
import { ReceiptsList } from "@/components/dashboard/receipts-list";
import type { Receipt } from "@/lib/database.types";

export function DashboardBody({
  initialReceipts,
}: {
  initialReceipts: Receipt[];
}) {
  const [receipts, setReceipts] = useState(initialReceipts);

  return (
    <div className="space-y-6">
      <UploadReceipt
        onSaved={(receipt) => setReceipts((prev) => [receipt, ...prev])}
      />
      <MonthlySummary receipts={receipts} />
      <ReceiptsList
        receipts={receipts}
        onDeleted={(id) =>
          setReceipts((prev) => prev.filter((r) => r.id !== id))
        }
      />
    </div>
  );
}
