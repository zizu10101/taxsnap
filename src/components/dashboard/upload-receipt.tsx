"use client";

import { useRef, useState } from "react";
import { Camera, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { TAX_CATEGORIES } from "@/lib/tax-categories";
import type { Receipt } from "@/lib/database.types";

interface ParsedDraft {
  merchant_name: string;
  transaction_date: string;
  total_amount: number;
  tax_amount: number;
  tax_category: string;
  items_summary: string;
  image_path: string | null;
  image_url: string | null;
}

export function UploadReceipt({
  onSaved,
}: {
  onSaved: (receipt: Receipt) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<ParsedDraft | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setPreviewImage(URL.createObjectURL(file));
    setParsing(true);

    try {
      const formData = new FormData();
      formData.append("image", file);

      const res = await fetch("/api/parse-receipt", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to parse receipt");
      }

      setDraft({
        ...data.parsed,
        image_path: data.image_path,
        image_url: data.image_url,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
      setPreviewImage(null);
    } finally {
      setParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleApprove() {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch("/api/receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchant_name: draft.merchant_name,
          transaction_date: draft.transaction_date,
          total_amount: draft.total_amount,
          tax_amount: draft.tax_amount,
          tax_category: draft.tax_category,
          items_summary: draft.items_summary,
          image_path: draft.image_path,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save receipt");

      onSaved(data.receipt as Receipt);
      toast.success("Receipt saved");
      closeModal();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  function closeModal() {
    setDraft(null);
    setPreviewImage(null);
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />
      <Button
        size="lg"
        className="h-16 w-full text-base font-semibold shadow-md"
        onClick={() => fileInputRef.current?.click()}
        disabled={parsing}
      >
        {parsing ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            Reading receipt...
          </>
        ) : (
          <>
            <Camera className="h-5 w-5" />
            Snap / Upload Receipt
          </>
        )}
      </Button>

      <Dialog open={!!draft} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Review extracted data
            </DialogTitle>
            <DialogDescription>
              We used AI to read this receipt. Fix anything that looks off,
              then approve to save it.
            </DialogDescription>
          </DialogHeader>

          {previewImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewImage}
              alt="Receipt preview"
              className="max-h-48 w-full rounded-md border object-contain"
            />
          )}

          {draft && (
            <div className="grid gap-4">
              <div className="space-y-2">
                <Label htmlFor="merchant_name">Merchant</Label>
                <Input
                  id="merchant_name"
                  value={draft.merchant_name}
                  onChange={(e) =>
                    setDraft({ ...draft, merchant_name: e.target.value })
                  }
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="transaction_date">Date</Label>
                  <Input
                    id="transaction_date"
                    type="date"
                    value={draft.transaction_date}
                    onChange={(e) =>
                      setDraft({ ...draft, transaction_date: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tax_category">Category</Label>
                  <Select
                    value={draft.tax_category}
                    onValueChange={(v) =>
                      v && setDraft({ ...draft, tax_category: v })
                    }
                  >
                    <SelectTrigger id="tax_category" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TAX_CATEGORIES.map((cat) => (
                        <SelectItem key={cat} value={cat}>
                          {cat}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="total_amount">Total ($)</Label>
                  <Input
                    id="total_amount"
                    type="number"
                    step="0.01"
                    value={draft.total_amount}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        total_amount: parseFloat(e.target.value) || 0,
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tax_amount">Sales tax ($)</Label>
                  <Input
                    id="tax_amount"
                    type="number"
                    step="0.01"
                    value={draft.tax_amount}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        tax_amount: parseFloat(e.target.value) || 0,
                      })
                    }
                  />
                </div>
              </div>

              {draft.items_summary && (
                <p className="text-sm text-muted-foreground">
                  {draft.items_summary}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeModal} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleApprove} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Approve & Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
