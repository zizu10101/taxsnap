"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { AttachPicker, type PickerItem } from "@/components/dashboard/attach-picker";
import { sha256Hex } from "@/lib/file-hash";
import type { DuplicateSummary } from "@/lib/receipt-duplicates";
import {
  AlreadyAttachedWarning,
  ExactFileDuplicateDialog,
  SimilarReceiptsWarning,
  useDuplicateChecks,
} from "@/components/dashboard/duplicate-warnings";
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
  /** SHA-256 of the ORIGINAL scanned file (before compression); only the hash is kept. */
  file_sha256: string | null;
}

// An expense a card-statement import created that this scan could be the
// receipt for (see /api/statements/attach-candidates).
interface AttachCandidate {
  id: string;
  kind: "vendor" | "exact" | "near" | "manual";
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
  // An expense the person picked BY HAND in the picker (not offered automatically).
  const [manualCandidate, setManualCandidate] = useState<AttachCandidate | null>(null);
  const manualIdRef = useRef<string | null>(null);
  // How many statement expenses are waiting for a receipt in total. The manual picker
  // is only offered when there is something in it to pick.
  const [waitingCount, setWaitingCount] = useState(0);
  // The dialog shows either the review form or the manual picker (a view swap, not a
  // nested dialog: stacked Base UI modals fight over focus and scroll-lock).
  const [view, setView] = useState<"review" | "picker">("review");
  // "" = not chosen yet, "new" = save as a new expense, otherwise the id of the
  // statement expense to attach this scan to.
  const [attachChoice, setAttachChoice] = useState("");
  const allCandidates = useMemo(
    () =>
      manualCandidate && !attachCandidates.some((c) => c.id === manualCandidate.id)
        ? [manualCandidate, ...attachCandidates]
        : attachCandidates,
    [manualCandidate, attachCandidates],
  );
  const selectedCandidate =
    attachChoice && attachChoice !== "new"
      ? (allCandidates.find((c) => c.id === attachChoice) ?? null)
      : null;
  const dateChange =
    selectedCandidate && draft && /^\d{4}-\d{2}-\d{2}$/.test(draft.transaction_date)
      ? periodChange(selectedCandidate.receipt.transaction_date, draft.transaction_date)
      : null;
  const mustChooseDate = !!dateChange?.crossesMonth;
  const cents = (n: number) => Math.round(n * 100);
  // The receipt's total and the card charge differ (a tip, a mismatch, a wrong pick).
  const amountMismatch =
    !!selectedCandidate && !!draft && cents(draft.total_amount) !== cents(selectedCandidate.receipt.total_amount);
  // Two confirmations the person must give, each tied to EXACTLY what they confirmed:
  // change the expense, the receipt's date or its total afterwards and the confirmation
  // stops applying, so it can never vouch for something they didn't look at.
  //  - which date to keep, when attaching would move the expense into another month
  //    (no default; the server refuses without it);
  //  - "I've checked the amounts", when the two amounts differ.
  const dateKey =
    selectedCandidate && draft
      ? `${selectedCandidate.id}|${selectedCandidate.receipt.transaction_date}|${draft.transaction_date}`
      : "";
  const amountsKey =
    selectedCandidate && draft
      ? `${selectedCandidate.id}|${cents(draft.total_amount)}|${cents(selectedCandidate.receipt.total_amount)}`
      : "";
  const [dateChoiceState, setDateChoiceState] = useState<{ key: string; value: "receipt" | "statement" } | null>(null);
  const [amountsOk, setAmountsOk] = useState("");
  const attachDateChoice = dateChoiceState && dateChoiceState.key === dateKey ? dateChoiceState.value : "";
  const amountsChecked = amountsKey !== "" && amountsOk === amountsKey;
  // Re-checking matches while the person edits the merchant, total or date.
  const lastCheckedRef = useRef("");
  const checkSeqRef = useRef(0);
  // The very same file was scanned before: shown BEFORE it is uploaded or read. "Continue anyway"
  // re-sends it with force=1; the File is kept here so the person doesn't have to pick it again.
  const [exactDuplicate, setExactDuplicate] = useState<{ file: File; matches: DuplicateSummary[] } | null>(null);
  // Same merchant + total within 2 days of a saved receipt, or a statement expense that already has
  // a receipt: soft warnings, never a block.
  const duplicateChecks = useDuplicateChecks(
    !!draft,
    draft?.total_amount ?? 0,
    draft?.transaction_date ?? "",
    draft?.merchant_name ?? "",
  );

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

  // Looks for statement expenses this scan could be the receipt for. Run when a receipt
  // is scanned (keepChoice false: start clean) and again, debounced, whenever the person
  // edits the merchant, total or date (keepChoice true: keep what they chose if it is
  // still on offer, instead of pulling it away mid-edit). An answer that arrives after a
  // newer request was sent is dropped.
  const loadAttachCandidates = useCallback(
    async (total: number, date: string, merchant: string, keepChoice = false) => {
      const seq = ++checkSeqRef.current;
      if (!keepChoice) {
        setAttachCandidates([]);
        setAttachChoice("");
        setManualCandidate(null);
        manualIdRef.current = null;
        setWaitingCount(0);
      }
      if (!statementImportEnabled) return;
      try {
        const params = new URLSearchParams({ total: String(total), date });
        if (merchant.trim()) params.set("merchant", merchant.trim());
        const res = await fetch(`/api/statements/attach-candidates?${params}`);
        if (!res.ok || seq !== checkSeqRef.current) return;
        const body = await res.json();
        if (seq !== checkSeqRef.current) return;
        const found = (body.candidates ?? []) as AttachCandidate[];
        setAttachCandidates(found);
        setWaitingCount(Number(body.waiting_count ?? 0));
        // The server preselects the nearest candidate only when it is clearly nearest
        // (a tie, or only close-amount guesses, preselect nothing). It is a
        // preselection: nothing is attached until Attach & Save is pressed.
        const preselect = typeof body.preselect_id === "string" ? body.preselect_id : "";
        setAttachChoice((prev) => {
          if (!keepChoice) return preselect;
          if (prev === "new") return prev; // they decided: a new expense
          if (prev && (found.some((c) => c.id === prev) || prev === manualIdRef.current)) return prev;
          return preselect;
        });
      } catch {
        // Best effort: saving a receipt works the same without this check.
      }
    },
    [statementImportEnabled],
  );

  const hasDraft = !!draft;
  const draftTotal = draft?.total_amount ?? 0;
  const draftDate = draft?.transaction_date ?? "";
  const draftMerchant = draft?.merchant_name ?? "";
  const pickerScan = useMemo(
    () => ({ merchant: draftMerchant, date: draftDate, total: draftTotal }),
    [draftMerchant, draftDate, draftTotal],
  );

  // Edit the merchant, total or date in the review form and the matches are looked up
  // again after a short pause (not on every keystroke). The first lookup, at scan
  // time, records its key so this doesn't repeat it.
  useEffect(() => {
    if (!statementImportEnabled || !hasDraft) return;
    const key = `${draftTotal}|${draftDate}|${draftMerchant}`;
    if (key === lastCheckedRef.current) return;
    const timer = setTimeout(() => {
      lastCheckedRef.current = key;
      void loadAttachCandidates(draftTotal, draftDate, draftMerchant, true);
    }, 600);
    return () => clearTimeout(timer);
  }, [statementImportEnabled, hasDraft, draftTotal, draftDate, draftMerchant, loadAttachCandidates]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await processFile(file, false);
  }

  async function processFile(file: File, force: boolean) {
    setParsing(true);

    try {
      // Fingerprint the ORIGINAL file, before it is compressed. Only this hash is ever stored.
      let fileHash: string | null = null;
      try {
        fileHash = await sha256Hex(file);
      } catch {
        // No Web Crypto here: skip the exact-file check; everything else still works.
      }

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
      if (fileHash) formData.append("file_sha256", fileHash);
      if (force) formData.append("force", "1");

      const res = await fetch("/api/parse-receipt", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      // The server found this exact file among the owner's receipts and stopped before any upload
      // or Gemini call. Show what it matched; nothing is lost either way.
      if (res.ok && data.duplicate?.file?.length) {
        setPreviewImage(null);
        setPreviewIsPdf(false);
        setExactDuplicate({ file, matches: data.duplicate.file as DuplicateSummary[] });
        return;
      }

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
        file_sha256: fileHash,
      });
      setJobMode(NO_JOB);
      setNewJobName("");
      lastCheckedRef.current = `${data.parsed.total_amount}|${data.parsed.transaction_date}|${data.parsed.merchant_name ?? ""}`;
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
    if (allCandidates.length > 0 && attachChoice === "") {
      toast.error("This may be a charge from your card statement. Choose which one, or Save as a new expense.");
      return;
    }
    if (mustChooseDate && attachDateChoice === "") {
      toast.error("Choose which date to keep: the receipt's or the statement's.");
      return;
    }
    if (selectedCandidate) {
      if (draft.tax_amount > selectedCandidate.receipt.total_amount + 0.005) {
        toast.error(
          `Sales tax can't be more than the expense's total ($${selectedCandidate.receipt.total_amount.toFixed(2)}).`,
        );
        return;
      }
      if (amountMismatch && !amountsChecked) {
        toast.error("The receipt total and the expense amount differ. Tick \"I've checked the amounts\" to continue.");
        return;
      }
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
            file_sha256: draft.file_sha256,
            ...(mustChooseDate && { keep_statement_date: attachDateChoice === "statement" }),
          }),
        });
        const attached = await attachRes.json();
        if (!attachRes.ok) throw new Error(attached.error || "Failed to attach receipt");
        (onAttached ?? onSaved)(attached.receipt as Receipt);
        toast.success("Receipt attached to your statement expense");
        router.refresh();
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
          file_sha256: draft.file_sha256,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save receipt");

      onSaved(data.receipt as Receipt);
      toast.success("Receipt saved");
      router.refresh();
      closeModal();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  // "Continue anyway" on the exact-file warning: the same file goes through the normal scan, with
  // the early stop switched off.
  async function handleContinueAnyway() {
    const pending = exactDuplicate;
    setExactDuplicate(null);
    if (pending) await processFile(pending.file, true);
  }

  function closeModal() {
    setDraft(null);
    setAttachCandidates([]);
    setAttachChoice("");
    setManualCandidate(null);
    manualIdRef.current = null;
    setWaitingCount(0);
    setView("review");
    setDateChoiceState(null);
    setAmountsOk("");
    lastCheckedRef.current = "";
    checkSeqRef.current += 1;
    setPreviewImage(null);
    setPreviewIsPdf(false);
  }

  // An expense chosen by hand in the picker becomes an option in the review view (labelled
  // "chosen by you") and is selected there; the usual date and amount confirmations apply.
  function handlePicked(item: PickerItem) {
    setManualCandidate({
      id: item.id,
      kind: item.kind ?? "manual",
      day_diff: item.day_diff,
      receipt: {
        id: item.id,
        merchant_name: item.merchant_name,
        transaction_date: item.date,
        total_amount: item.amount,
      },
    });
    manualIdRef.current = item.id;
    setAttachChoice(item.id);
    setView("review");
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
          {view === "picker" && draft ? (
            <>
              <DialogHeader>
                <DialogTitle>Attach to an existing expense</DialogTitle>
                <DialogDescription>
                  Choose the card-statement expense this receipt belongs to. It keeps the amount that
                  was charged to your card.
                </DialogDescription>
              </DialogHeader>
              <AttachPicker
                scan={pickerScan}
                selectedId={selectedCandidate?.id ?? null}
                onChoose={handlePicked}
                onBack={() => setView("review")}
              />
            </>
          ) : (
            <>
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

          {allCandidates.length > 0 && (
            <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
              <p className="font-medium">This may be a charge from your card statement</p>
              <p className="text-xs text-muted-foreground">
                Attaching adds this photo and its tax to that expense instead of creating a second
                one. The expense keeps the amount that was charged to your card.
              </p>
              <div className="space-y-1.5">
                {allCandidates.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-start gap-2 text-xs">
                    <input
                      type="radio"
                      name="attach-choice"
                      className="mt-0.5"
                      checked={attachChoice === c.id}
                      onChange={() => setAttachChoice(c.id)}
                    />
                    <span>
                      {c.receipt.merchant_name} · {c.receipt.transaction_date} · $
                      {c.receipt.total_amount.toFixed(2)}
                      <span className="ml-1 text-muted-foreground">
                        (
                        {c.kind === "manual"
                          ? "chosen by you"
                          : c.kind === "vendor"
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
                    onChange={() => setAttachChoice("new")}
                  />
                  <span>Save as a new expense</span>
                </label>
              </div>
              {waitingCount > 0 && (
                <button
                  type="button"
                  className="text-xs text-primary underline underline-offset-2"
                  onClick={() => setView("picker")}
                >
                  None of these? Attach to a different expense...
                </button>
              )}
            </div>
          )}

          {statementImportEnabled && draft && allCandidates.length === 0 && waitingCount > 0 && (
            <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
              <p className="font-medium">No statement expense matched this receipt</p>
              <p className="text-xs text-muted-foreground">
                Is it for a charge on a card statement you&apos;ve already imported? You can pick that
                expense yourself and attach the receipt to it.
              </p>
              <Button size="sm" variant="outline" onClick={() => setView("picker")}>
                Attach to an existing expense...
              </Button>
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
                    onChange={() => setDateChoiceState({ key: dateKey, value: "statement" })}
                  />
                  <span>Keep the statement date ({selectedCandidate.receipt.transaction_date})</span>
                </label>
                <label className="flex cursor-pointer items-start gap-2 text-xs">
                  <input
                    type="radio"
                    name="attach-date-choice"
                    className="mt-0.5"
                    checked={attachDateChoice === "receipt"}
                    onChange={() => setDateChoiceState({ key: dateKey, value: "receipt" })}
                  />
                  <span>Use the receipt date ({draft.transaction_date})</span>
                </label>
              </div>
            </div>
          )}

          {amountMismatch && selectedCandidate && draft && (
            <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <p className="font-medium">The amounts don&apos;t match</p>
              <p className="text-xs text-muted-foreground">
                Your receipt says ${draft.total_amount.toFixed(2)}, but your card was charged $
                {selectedCandidate.receipt.total_amount.toFixed(2)}. The expense keeps the card amount
                (${selectedCandidate.receipt.total_amount.toFixed(2)}); only the photo, the tax and the
                items come from this receipt.
              </p>
              <label className="flex cursor-pointer items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={amountsChecked}
                  onChange={(e) => setAmountsOk(e.target.checked ? amountsKey : "")}
                />
                <span>I&apos;ve checked the amounts</span>
              </label>
            </div>
          )}
          <AlreadyAttachedWarning matches={duplicateChecks.attached} />
          <SimilarReceiptsWarning matches={duplicateChecks.similar} />

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
              {attachChoice && attachChoice !== "new"
                ? "Attach & Save"
                : duplicateChecks.similar.length + duplicateChecks.attached.length > 0
                  ? "Save anyway"
                  : "Approve & Save"}
            </Button>
          </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ExactFileDuplicateDialog
        matches={exactDuplicate?.matches ?? null}
        onCancel={() => setExactDuplicate(null)}
        onContinue={handleContinueAnyway}
      />
    </>
  );
}
