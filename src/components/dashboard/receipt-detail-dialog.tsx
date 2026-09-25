"use client";

import { useMemo, useState } from "react";
import {
  Briefcase,
  ImageIcon,
  ListChecks,
  Loader2,
  Pencil,
  Plus,
  Receipt as ReceiptIcon,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TAX_CATEGORIES } from "@/lib/tax-categories";
import { ReceiptImage } from "@/components/dashboard/receipt-image";
import type { Receipt, ReceiptItem } from "@/lib/database.types";

const EMPTY_ITEM: ReceiptItem = { name: "", amount: 0 };

// Sentinel values for the job Select, mirroring the client picker's
// "+ Add new client" inline-create pattern in document-builder.tsx. Native
// <input list>/<datalist> autocomplete doesn't render as a real dropdown on
// most mobile browsers - it just looks like a plain text box - so this uses
// the app's own Select for a picker that actually works on phones.
const NO_JOB = "__no_job__";
const NEW_JOB = "__new_job__";

function initialJobMode(jobName: string, existingJobs: string[]): string {
  if (!jobName) return NO_JOB;
  if (existingJobs.includes(jobName)) return jobName;
  return NEW_JOB;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatDate(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function itemsOf(receipt: Receipt): ReceiptItem[] {
  return Array.isArray(receipt.items) ? receipt.items : [];
}

interface EditForm {
  merchant_name: string;
  transaction_date: string;
  tax_category: string;
  total_amount: number;
  tax_amount: number;
  items: ReceiptItem[];
  job_name: string;
}

function toForm(receipt: Receipt): EditForm {
  const items = itemsOf(receipt);
  return {
    merchant_name: receipt.merchant_name,
    transaction_date: receipt.transaction_date,
    tax_category: receipt.tax_category,
    total_amount: receipt.total_amount,
    tax_amount: receipt.tax_amount,
    items: items.length ? items : [{ ...EMPTY_ITEM }],
    job_name: receipt.job_name ?? "",
  };
}

// Keyed by receipt.id from the parent so editing state resets cleanly
// whenever the dialog is pointed at a different receipt.
function ReceiptSummaryContent({
  receipt,
  existingJobs,
  onOpenChange,
  onDeleted,
  onUpdated,
}: {
  receipt: Receipt;
  existingJobs: string[];
  onOpenChange: (open: boolean) => void;
  onDeleted: (id: string) => void;
  onUpdated: (receipt: Receipt) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<EditForm>(() => toForm(receipt));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [jobMode, setJobMode] = useState<string>(() =>
    initialJobMode(form.job_name, existingJobs),
  );
  const [newJobName, setNewJobName] = useState<string>(() =>
    jobMode === NEW_JOB ? form.job_name : "",
  );

  const jobSelectItems = useMemo(() => {
    const map: Record<string, string> = { [NO_JOB]: "No job", [NEW_JOB]: "+ Add new job" };
    for (const job of existingJobs) map[job] = job;
    return map;
  }, [existingJobs]);

  function handleJobModeChange(value: string) {
    setJobMode(value);
    if (value === NO_JOB) {
      setForm({ ...form, job_name: "" });
    } else if (value === NEW_JOB) {
      setForm({ ...form, job_name: newJobName });
    } else {
      setForm({ ...form, job_name: value });
    }
  }

  function handleNewJobNameChange(value: string) {
    setNewJobName(value);
    setForm({ ...form, job_name: value });
  }

  function updateItem(index: number, patch: Partial<ReceiptItem>) {
    setForm({
      ...form,
      items: form.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/receipts/${receipt.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchant_name: form.merchant_name,
          transaction_date: form.transaction_date,
          total_amount: form.total_amount,
          tax_amount: form.tax_amount,
          tax_category: form.tax_category,
          items: form.items.filter((i) => i.name.trim()),
          job_name: form.job_name,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save changes");

      onUpdated(data.receipt as Receipt);
      toast.success("Receipt updated");
      setIsEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/receipts/${receipt.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete receipt");
      }
      onDeleted(receipt.id);
      toast.success("Receipt deleted");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setDeleting(false);
    }
  }

  if (isEditing) {
    const subtotal = form.total_amount - form.tax_amount;

    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="font-heading text-base font-semibold">Edit receipt</h2>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid flex-1 gap-4 overflow-y-auto p-5">
          <div className="space-y-2">
            <Label htmlFor="edit-merchant">Merchant</Label>
            <Input
              id="edit-merchant"
              value={form.merchant_name}
              onChange={(e) =>
                setForm({ ...form, merchant_name: e.target.value })
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-date">Date</Label>
              <Input
                id="edit-date"
                type="date"
                value={form.transaction_date}
                onChange={(e) =>
                  setForm({ ...form, transaction_date: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-category">Category</Label>
              <Select
                value={form.tax_category}
                onValueChange={(v) => v && setForm({ ...form, tax_category: v })}
              >
                <SelectTrigger id="edit-category" className="w-full">
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
              <Label htmlFor="edit-total">Total ($)</Label>
              <NumberInput
                id="edit-total"
                step="0.01"
                value={form.total_amount}
                onValueChange={(total_amount) =>
                  setForm({ ...form, total_amount })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-tax">Sales tax ($)</Label>
              <NumberInput
                id="edit-tax"
                step="0.01"
                value={form.tax_amount}
                onValueChange={(tax_amount) => setForm({ ...form, tax_amount })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Items purchased</Label>
            {form.items.map((item, i) => (
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
                    setForm({
                      ...form,
                      items: form.items.filter((_, idx) => idx !== i),
                    })
                  }
                  disabled={form.items.length === 1}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setForm({ ...form, items: [...form.items, { ...EMPTY_ITEM }] })
              }
            >
              <Plus className="h-4 w-4" />
              Add item
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-job">Job (optional)</Label>
            <Select
              items={jobSelectItems}
              value={jobMode}
              onValueChange={(v) => v && handleJobModeChange(v)}
            >
              <SelectTrigger id="edit-job" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_JOB}>No job</SelectItem>
                <SelectItem value={NEW_JOB}>+ Add new job</SelectItem>
                {existingJobs.map((job) => (
                  <SelectItem key={job} value={job}>
                    {job}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {jobMode === NEW_JOB && (
              <Input
                placeholder="e.g. 123 Main St or Job #4521"
                value={newJobName}
                onChange={(e) => handleNewJobNameChange(e.target.value)}
              />
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Subtotal {formatCurrency(subtotal)} + tax{" "}
            {formatCurrency(form.tax_amount)} = total{" "}
            {formatCurrency(form.total_amount)}
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t p-4">
          <Button
            variant="outline"
            onClick={() => {
              const reverted = toForm(receipt);
              setForm(reverted);
              setJobMode(initialJobMode(reverted.job_name, existingJobs));
              setNewJobName(reverted.job_name);
              setIsEditing(false);
            }}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </div>
      </div>
    );
  }

  const items = itemsOf(receipt);
  const subtotal = receipt.total_amount - receipt.tax_amount;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              <ReceiptIcon className="h-3.5 w-3.5" />
              Receipt Summary
            </div>
            <h2 className="truncate font-heading text-xl font-semibold">
              {receipt.merchant_name}
            </h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {formatDate(receipt.transaction_date)}
          </span>
          <Badge variant="secondary">{receipt.tax_category}</Badge>
        </div>
        {receipt.job_name && (
          <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <Briefcase className="h-3.5 w-3.5" />
            {receipt.job_name}
          </div>
        )}
      </div>

      <Tabs defaultValue="items" className="min-h-0 flex-1">
        <TabsList variant="line" className="mx-5 mt-3 h-auto border-b pb-0">
          <TabsTrigger value="items" className="gap-1.5 pb-2.5">
            <ListChecks className="h-4 w-4" />
            Extracted Items
          </TabsTrigger>
          <TabsTrigger value="photo" className="gap-1.5 pb-2.5">
            <ImageIcon className="h-4 w-4" />
            Original Receipt
          </TabsTrigger>
        </TabsList>

        <TabsContent value="items" className="flex-1 overflow-y-auto p-5">
          <div className="rounded-lg border">
            <div className="space-y-1.5 p-4">
              <p className="text-xs text-muted-foreground">Items purchased</p>
              {items.length > 0 ? (
                <ul className="space-y-1 text-sm">
                  {items.map((item, i) => (
                    <li key={i} className="flex items-center justify-between gap-3">
                      <span className="truncate">{item.name}</span>
                      <span className="shrink-0 tabular-nums">
                        {formatCurrency(item.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">—</p>
              )}
            </div>

            <Separator />

            <div className="space-y-2 p-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular-nums">{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Sales tax</span>
                <span className="tabular-nums">
                  {formatCurrency(receipt.tax_amount)}
                </span>
              </div>
            </div>

            <Separator />

            <div className="flex items-center justify-between p-4">
              <span className="font-semibold">Total</span>
              <span className="text-lg font-semibold tabular-nums">
                {formatCurrency(receipt.total_amount)}
              </span>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="photo" className="flex-1 overflow-y-auto p-5">
          {receipt.image_url ? (
            <ReceiptImage
              key={receipt.image_url}
              path={receipt.image_url}
              className="flex min-h-[320px] items-center justify-center rounded-lg border bg-muted/30 p-3"
              imgClassName="max-h-[420px] w-full rounded-md object-contain"
            />
          ) : (
            <div className="flex min-h-[320px] flex-col items-center justify-center gap-2 rounded-lg border bg-muted/30 text-center text-muted-foreground">
              <ImageIcon className="h-8 w-8" />
              <p className="text-sm">No photo was saved with this receipt.</p>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <div className="flex items-center justify-between gap-2 border-t p-4">
        <Button
          variant="outline"
          onClick={handleDelete}
          disabled={deleting}
          className="text-destructive hover:text-destructive"
        >
          {deleting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
          Delete
        </Button>
        <Button variant="outline" onClick={() => setIsEditing(true)}>
          <Pencil className="h-4 w-4" />
          Edit
        </Button>
      </div>
    </div>
  );
}

export function ReceiptDetailDialog({
  receipt,
  existingJobs = [],
  onOpenChange,
  onDeleted,
  onUpdated,
}: {
  receipt: Receipt | null;
  existingJobs?: string[];
  onOpenChange: (open: boolean) => void;
  onDeleted: (id: string) => void;
  onUpdated: (receipt: Receipt) => void;
}) {
  // The parent nulls `receipt` out the instant closing starts, but the
  // Sheet's own popup stays mounted for its ~200ms slide-out animation
  // (Base UI's data-closed/data-ending-style exit transition). Rendering
  // content straight off `receipt` would unmount it in that same tick,
  // so the panel visibly slides away empty - a flicker right on close.
  // Keeping the last non-null receipt here (render-time "adjust state
  // from props", not an effect, per this codebase's own convention) lets
  // the content stay put for the full close animation; it's harmless for
  // it to still hold stale data once the panel is actually gone.
  const [displayedReceipt, setDisplayedReceipt] = useState<Receipt | null>(receipt);
  if (receipt && receipt !== displayedReceipt) {
    setDisplayedReceipt(receipt);
  }

  return (
    // "trap-focus" instead of the default `true`: full modal mode locks
    // document scroll via a scroll-lock effect that Base UI defers with a
    // setTimeout(0) (see @base-ui/utils/useScrollLock) - that fires one
    // tick after this popup's own CSS slide-in animation has already
    // started painting, forcing a layout recalculation mid-transition,
    // which is what actually reads as a flicker/jank on open, not the
    // animation itself. "trap-focus" keeps keyboard focus trapped inside
    // the drawer (still behaves like a real modal drawer) without ever
    // invoking that scroll-lock path.
    // overlay={false}: the dimming backdrop's own fade-out isn't guaranteed
    // to finish before Base UI tears the whole popup down (see sheet.tsx's
    // comment on SheetContent) - tuning its duration couldn't close that
    // gap cleanly, so this drawer skips the backdrop rather than risk a
    // flicker back to full tint right as it closes. The panel's own shadow
    // still gives it depth against the page without one.
    <Sheet open={!!receipt} onOpenChange={onOpenChange} modal="trap-focus">
      <SheetContent side="right" overlay={false}>
        {displayedReceipt && (
          <ReceiptSummaryContent
            key={displayedReceipt.id}
            receipt={displayedReceipt}
            existingJobs={existingJobs}
            onOpenChange={onOpenChange}
            onDeleted={onDeleted}
            onUpdated={onUpdated}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
