"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Camera,
  FileText,
  ImageUp,
  Loader2,
  Plus,
  Sparkles,
  TriangleAlert,
  Trash2,
} from "lucide-react";
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
import { useExpenseCategoryOptions } from "@/components/owner-lists-provider";
import { PaidWithSelect } from "@/components/dashboard/paid-with-select";
import { compressImage } from "@/lib/compress-image";
import { periodChange } from "@/lib/statement-attach-period";
import type { Receipt, ReceiptItem } from "@/lib/database.types";

interface ParsedDraft {
  merchant_name: string;
  transaction_date: string;
  /** True when the AI had to guess the day/month order - see gemini.ts. */
  date_ambiguous: boolean;
  total_amount: number;
  tax_amount: number;
  tax_category: string;
  items: ReceiptItem[];
  job_name: string;
  /** Optional "Paid with" account id from the owner's accounts list, "" for none. */
  paid_with_account_id: string;
  image_path: string | null;
  image_url: string | null;
}

// An expense a card-statement import created that this scan could be the
// receipt for (see /api/statements/attach-candidates).
interface AttachCandidate {
  id: string;
  kind: "vendor" | "exact" | "near";
  /** Days between the scan's date and the expense's. */
  day_diff: number;
  receipt: {
    id: string;
    merchant_name: string;
    transaction_date: string;
    total_amount: number;
  };
}

const EMPTY_ITEM: ReceiptItem = { name: "", amount: 0 };

// Sentinel values for the job Select, mirroring the client picker's
// "+ Add new client" inline-create pattern in document-builder.tsx. Native
// <input list>/<datalist> autocomplete doesn't render as a real dropdown on
// most mobile browsers - it just looks like a plain text box - so this uses
// the app's own Select for a picker that actually works on phones.
const NO_JOB = "__no_job__";
const NEW_JOB = "__new_job__";

export function UploadReceipt({
  onSaved,
  onAttached,
  statementImportEnabled = false,
  existingJobs = [],
  variant = "hero",
}: {
  onSaved: (receipt: Receipt) => void;
  // Called instead of onSaved when the scan was attached to an existing
  // statement-created expense (the row already exists, so it is replaced, not added).
  onAttached?: (receipt: Receipt) => void;
  // Card-statement import is allowlist-only; when off, no attach check runs.
  statementImportEnabled?: boolean;
  existingJobs?: string[];
  // "tile" = quick-actions grid tile (flex-col, icon over label). "hero" =
  // the page header's own compact primary action, sized to sit inline next
  // to a secondary button rather than full-width. "compact" = a plain small
  // "Upload Receipt" button for a toolbar (the Expenses tab): one click opens
  // the file picker, which accepts photos and documents alike - on a phone the
  // system picker itself offers Take Photo / Photo Library / Files, so the
  // camera is still one tap away without a menu here.
  variant?: "hero" | "tile" | "compact";
}) {
  const router = useRouter();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<ParsedDraft | null>(null);
  const categoryOptions = useExpenseCategoryOptions(draft?.tax_category);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewIsPdf, setPreviewIsPdf] = useState(false);
  const [jobMode, setJobMode] = useState<string>(NO_JOB);
  const [newJobName, setNewJobName] = useState("");
  const [attachCandidates, setAttachCandidates] = useState<AttachCandidate[]>([]);
  // "" = not chosen yet, "new" = save as a new expense, otherwise the id of the
  // statement expense to attach this scan to.
  const [attachChoice, setAttachChoice] = useState("");
  // Which date the expense keeps when attaching would move it into another month.
  // No default: it has to be chosen (and the server refuses without it).
  const [attachDateChoice, setAttachDateChoice] = useState<"" | "receipt" | "statement">("");
  const selectedCandidate =
    attachChoice && attachChoice !== "new"
      ? (attachCandidates.find((c) => c.id === attachChoice) ?? null)
      : null;
  const dateChange =
    selectedCandidate && draft && /^\d{4}-\d{2}-\d{2}$/.test(draft.transaction_date)
      ? periodChange(selectedCandidate.receipt.transaction_date, draft.transaction_date)
      : null;
  const mustChooseDate = !!dateChange?.crossesMonth;

  const jobSelectItems = useMemo(() => {
    const map: Record<string, string> = { [NO_JOB]: "No job", [NEW_JOB]: "+ Add new job" };
    for (const job of existingJobs) map[job] = job;
    return map;
  }, [existingJobs]);

  function handleJobModeChange(value: string) {
    if (!draft) return;
    setJobMode(value);
    if (value === NO_JOB) {
      setDraft({ ...draft, job_name: "" });
    } else if (value === NEW_JOB) {
      setDraft({ ...draft, job_name: newJobName });
    } else {
      setDraft({ ...draft, job_name: value });
    }
  }

  function handleNewJobNameChange(value: string) {
    if (!draft) return;
    setNewJobName(value);
    setDraft({ ...draft, job_name: value });
  }

  async function loadAttachCandidates(total: number, date: string, merchant: string) {
    setAttachCandidates([]);
    setAttachChoice("");
    setAttachDateChoice("");
    if (!statementImportEnabled) return;
    try {
      const params = new URLSearchParams({ total: String(total), date });
      if (merchant.trim()) params.set("merchant", merchant.trim());
      const res = await fetch(`/api/statements/attach-candidates?${params}`);
      if (!res.ok) return;
      const body = await res.json();
      setAttachCandidates((body.candidates ?? []) as AttachCandidate[]);
      // The server preselects the nearest candidate only when it is clearly nearest
      // (a tie, or only close-amount guesses, preselect nothing). It is a
      // preselection: nothing is attached until Attach & Save is pressed.
      if (typeof body.preselect_id === "string") setAttachChoice(body.preselect_id);
    } catch {
      // Best effort: saving a receipt works the same without this check.
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setParsing(true);

    try {
      const isPdf = file.type === "application/pdf";
      // PDFs can't be decoded by <img>/canvas, so compressing one would just
      // fail and fall back to the original anyway - skip the wasted attempt.
      const compressed = isPdf
        ? file
        : await compressImage(file, { maxWidth: 1024 }).catch(() => file);
      setPreviewImage(URL.createObjectURL(compressed));
      setPreviewIsPdf(isPdf);

      const formData = new FormData();
      formData.append("image", compressed);

      const res = await fetch("/api/parse-receipt", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.code === "FREE_LIMIT_REACHED") {
          toast.error(data.error, {
            action: { label: "Upgrade", onClick: () => router.push("/billing") },
          });
          setPreviewImage(null);
          setPreviewIsPdf(false);
          return;
        }
        throw new Error(data.error || "Failed to parse receipt");
      }

      setDraft({
        ...data.parsed,
        items: data.parsed.items?.length ? data.parsed.items : [{ ...EMPTY_ITEM }],
        job_name: "",
        paid_with_account_id: "",
        image_path: data.image_path,
        image_url: data.image_url,
      });
      setJobMode(NO_JOB);
      setNewJobName("");
      await loadAttachCandidates(
        data.parsed.total_amount,
        data.parsed.transaction_date,
        data.parsed.merchant_name ?? "",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
      setPreviewImage(null);
      setPreviewIsPdf(false);
    } finally {
      setParsing(false);
      if (cameraInputRef.current) cameraInputRef.current.value = "";
      if (libraryInputRef.current) libraryInputRef.current.value = "";
    }
  }

  async function handleApprove() {
    if (!draft) return;
    if (attachCandidates.length > 0 && attachChoice === "") {
      toast.error("This may be a charge from your card statement. Choose which one, or Save as a new expense.");
      return;
    }
    if (mustChooseDate && attachDateChoice === "") {
      toast.error("Choose which date to keep: the receipt's or the statement's.");
      return;
    }
    setSaving(true);
    try {
      if (attachChoice && attachChoice !== "new") {
        const attachRes = await fetch(`/api/receipts/${attachChoice}/attach`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image_path: draft.image_path,
            tax_amount: draft.tax_amount,
            merchant_name: draft.merchant_name,
            transaction_date: draft.transaction_date,
            items: draft.items.filter((i) => i.name.trim()),
            ...(mustChooseDate && { keep_statement_date: attachDateChoice === "statement" }),
          }),
        });
        const attached = await attachRes.json();
        if (!attachRes.ok) throw new Error(attached.error || "Failed to attach receipt");
        (onAttached ?? onSaved)(attached.receipt as Receipt);
        toast.success("Receipt attached to your statement expense");
        closeModal();
        return;
      }
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
          paid_with_account_id: draft.paid_with_account_id,
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
    setAttachCandidates([]);
    setAttachChoice("");
    setAttachDateChoice("");
    setPreviewImage(null);
    setPreviewIsPdf(false);
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
        accept="image/*,application/pdf"
        className="hidden"
        onChange={handleFileChange}
      />
      {variant === "compact" ? (
        <Button
          variant="outline"
          size="sm"
          disabled={parsing}
          onClick={() => libraryInputRef.current?.click()}
        >
          {parsing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Reading...
            </>
          ) : (
            <>
              <ImageUp className="h-4 w-4" />
              Upload Receipt
            </>
          )}
        </Button>
      ) : (
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
              <Button size="lg" className="font-semibold" disabled={parsing} />
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
              <Loader2 className="h-4 w-4 animate-spin" />
              Reading...
            </>
          ) : (
            <>
              <Camera className="h-4 w-4" />
              Scan Receipt
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
            Upload Receipt
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      )}

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

          {previewImage && previewIsPdf && (
            <div className="flex max-h-48 w-full items-center gap-2 rounded-md border bg-muted p-4 text-sm text-muted-foreground">
              <FileText className="h-5 w-5 shrink-0" />
              Receipt file uploaded
            </div>
          )}
          {previewImage && !previewIsPdf && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewImage}
              alt="Receipt preview"
              className="max-h-48 w-full rounded-md border object-contain"
            />
          )}

          {attachCandidates.length > 0 && (
            <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
              <p className="font-medium">This may be a charge from your card statement</p>
              <p className="text-xs text-muted-foreground">
                Attaching adds this photo and its tax to that expense instead of creating a second
                one. The expense keeps the amount that was charged to your card.
              </p>
              <div className="space-y-1.5">
                {attachCandidates.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-start gap-2 text-xs">
                    <input
                      type="radio"
                      name="attach-choice"
                      className="mt-0.5"
                      checked={attachChoice === c.id}
                      onChange={() => {
                        setAttachChoice(c.id);
                        setAttachDateChoice("");
                      }}
                    />
                    <span>
                      {c.receipt.merchant_name} · {c.receipt.transaction_date} · $
                      {c.receipt.total_amount.toFixed(2)}
                      <span className="ml-1 text-muted-foreground">
                        (
                        {c.kind === "vendor"
                          ? `same vendor and amount, ${c.day_diff} day${c.day_diff === 1 ? "" : "s"} apart`
                          : c.kind === "exact"
                            ? "same amount"
                            : "close, not exact"}
                        )
                      </span>
                    </span>
                  </label>
                ))}
                <label className="flex cursor-pointer items-start gap-2 text-xs">
                  <input
                    type="radio"
                    name="attach-choice"
                    className="mt-0.5"
                    checked={attachChoice === "new"}
                    onChange={() => {
                      setAttachChoice("new");
                      setAttachDateChoice("");
                    }}
                  />
                  <span>Save as a new expense</span>
                </label>
              </div>
            </div>
          )}

          {mustChooseDate && dateChange && selectedCandidate && draft && (
            <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <p className="font-medium">
                This moves the expense into a different {dateChange.crossesQuarter ? "quarter" : "month"}
              </p>
              <p className="text-xs text-muted-foreground">
                Your card was charged on {selectedCandidate.receipt.transaction_date}; this receipt is
                dated {draft.transaction_date}. Attaching it would change the expense from{" "}
                {dateChange.fromMonth} ({dateChange.fromQuarter}) to {dateChange.toMonth} (
                {dateChange.toQuarter}), which can change the HST period it falls in. Choose the date
                to keep.
              </p>
              <div className="space-y-1.5">
                <label className="flex cursor-pointer items-start gap-2 text-xs">
                  <input
                    type="radio"
                    name="attach-date-choice"
                    className="mt-0.5"
                    checked={attachDateChoice === "statement"}
                    onChange={() => setAttachDateChoice("statement")}
                  />
                  <span>Keep the statement date ({selectedCandidate.receipt.transaction_date})</span>
                </label>
                <label className="flex cursor-pointer items-start gap-2 text-xs">
                  <input
                    type="radio"
                    name="attach-date-choice"
                    className="mt-0.5"
                    checked={attachDateChoice === "receipt"}
                    onChange={() => setAttachDateChoice("receipt")}
                  />
                  <span>Use the receipt date ({draft.transaction_date})</span>
                </label>
              </div>
            </div>
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
                  <Label
                    htmlFor="transaction_date"
                    className={draft.date_ambiguous ? "text-destructive" : undefined}
                  >
                    Date {draft.date_ambiguous && "- please confirm"}
                  </Label>
                  <Input
                    id="transaction_date"
                    type="date"
                    value={draft.transaction_date}
                    aria-invalid={draft.date_ambiguous}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        transaction_date: e.target.value,
                        date_ambiguous: false,
                      })
                    }
                  />
                  {draft.date_ambiguous && (
                    <p className="flex items-start gap-1 text-xs text-destructive">
                      <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                      The date on this receipt was unclear - double check it
                      before saving.
                    </p>
                  )}
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
                      {categoryOptions.map((cat) => (
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

              <PaidWithSelect
                id="paid_with"
                value={draft.paid_with_account_id}
                onChange={(paid_with_account_id) => setDraft({ ...draft, paid_with_account_id })}
              />

              <div className="space-y-2">
                <Label htmlFor="job_name">Job (optional)</Label>
                <Select
                  items={jobSelectItems}
                  value={jobMode}
                  onValueChange={(v) => v && handleJobModeChange(v)}
                >
                  <SelectTrigger id="job_name" className="w-full">
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
              {attachChoice && attachChoice !== "new" ? "Attach & Save" : "Approve & Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
