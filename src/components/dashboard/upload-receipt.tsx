"use client";

import { useRef, useState } from "react";
import { Camera, ImageUp, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TAX_CATEGORIES } from "@/lib/tax-categories";
import { compressImage } from "@/lib/compress-image";
import type { Receipt, ReceiptItem } from "@/lib/database.types";

interface ParsedDraft {
  merchant_name: string;
  transaction_date: string;
  total_amount: number;
  tax_amount: number;
  tax_category: string;
  items: ReceiptItem[];
  job_name: string;
  image_path: string | null;
  image_url: string | null;
}

const EMPTY_ITEM: ReceiptItem = { name: "", amount: 0 };

export function UploadReceipt({
  onSaved,
  existingJobs = [],
  variant = "hero",
}: {
  onSaved: (receipt: Receipt) => void;
  existingJobs?: string[];
  variant?: "hero" | "tile";
}) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<ParsedDraft | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setParsing(true);

    try {
      const compressed = await compressImage(file, { maxWidth: 1024 }).catch(
        () => file,
      );
      setPreviewImage(URL.createObjectURL(compressed));

      const formData = new FormData();
      formData.append("image", compressed);

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
        items: data.parsed.items?.length ? data.parsed.items : [{ ...EMPTY_ITEM }],
        job_name: "",
        image_path: data.image_path,
        image_url: data.image_url,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
      setPreviewImage(null);
    } finally {
      setParsing(false);
      if (cameraInputRef.current) cameraInputRef.current.value = "";
      if (libraryInputRef.current) libraryInputRef.current.value = "";
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
          items: draft.items.filter((i) => i.name.trim()),
          job_name: draft.job_name,
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

  function updateItem(index: number, patch: Partial<ReceiptItem>) {
    if (!draft) return;
    setDraft({
      ...draft,
      items: draft.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    });
  }

  return (
    <>
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            variant === "tile" ? (
              <Button
                variant="outline"
                className="h-20 w-full flex-col gap-1.5 text-xs font-semibold"
                disabled={parsing}
              />
            ) : (
              <Button
                size="lg"
                className="h-16 w-full text-base font-semibold shadow-md"
                disabled={parsing}
              />
            )
          }
        >
          {variant === "tile" ? (
            parsing ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Reading...
              </>
            ) : (
              <>
                <Camera className="h-5 w-5" />
                Scan Receipt
              </>
            )
          ) : parsing ? (
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
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center">
          <DropdownMenuItem onClick={() => cameraInputRef.current?.click()}>
            <Camera className="h-4 w-4" />
            Take Photo
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => libraryInputRef.current?.click()}>
            <ImageUp className="h-4 w-4" />
            Choose from Library
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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
                  <NumberInput
                    id="total_amount"
                    step="0.01"
                    value={draft.total_amount}
                    onValueChange={(total_amount) =>
                      setDraft({ ...draft, total_amount })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tax_amount">Sales tax ($)</Label>
                  <NumberInput
                    id="tax_amount"
                    step="0.01"
                    value={draft.tax_amount}
                    onValueChange={(tax_amount) =>
                      setDraft({ ...draft, tax_amount })
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="job_name">Job name / number (optional)</Label>
                <Input
                  id="job_name"
                  list="job-name-options"
                  placeholder="e.g. 123 Main St or Job #4521"
                  value={draft.job_name}
                  onChange={(e) =>
                    setDraft({ ...draft, job_name: e.target.value })
                  }
                />
                <datalist id="job-name-options">
                  {existingJobs.map((job) => (
                    <option key={job} value={job} />
                  ))}
                </datalist>
              </div>

              <div className="space-y-2">
                <Label>Items purchased</Label>
                {draft.items.map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      placeholder="Item"
                      className="flex-1"
                      value={item.name}
                      onChange={(e) => updateItem(i, { name: e.target.value })}
                    />
                    <NumberInput
                      step="0.01"
                      placeholder="Price"
                      className="w-24"
                      value={item.amount}
                      onValueChange={(amount) => updateItem(i, { amount })}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          items: draft.items.filter((_, idx) => idx !== i),
                        })
                      }
                      disabled={draft.items.length === 1}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setDraft({ ...draft, items: [...draft.items, { ...EMPTY_ITEM }] })
                  }
                >
                  <Plus className="h-4 w-4" />
                  Add item
                </Button>
              </div>
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
