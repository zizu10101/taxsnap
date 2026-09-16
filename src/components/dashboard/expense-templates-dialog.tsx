"use client";

import { useState } from "react";
import { Loader2, Pencil, Repeat, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ExpenseTemplateEditDialog } from "@/components/dashboard/expense-template-edit-dialog";
import type { ExpenseTemplateWithJob } from "@/lib/database.types";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

const RECURRENCE_LABEL: Record<string, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

// Doubles as both the "From Template" picker (tap a row to log an
// expense from it) and the management list (edit/delete) - the ask was
// for templates to be "manageable ... inline on the Expenses tab" rather
// than a separate Settings page, so both live in this one dialog instead
// of two.
export function ExpenseTemplatesDialog({
  open,
  onOpenChange,
  templates,
  existingJobs,
  onUse,
  onUpdated,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: ExpenseTemplateWithJob[];
  existingJobs: string[];
  onUse: (template: ExpenseTemplateWithJob) => void;
  onUpdated: (template: ExpenseTemplateWithJob) => void;
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState<ExpenseTemplateWithJob | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/expense-templates/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete template");
      }
      onDeleted(id);
      toast.success("Template deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Expense Templates</DialogTitle>
            <DialogDescription>
              Tap a template to log a new expense from it, or edit/delete it below.
            </DialogDescription>
          </DialogHeader>

          {templates.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
              <Repeat className="h-8 w-8" />
              <p className="text-sm">
                No templates yet. Check &quot;Save as reusable template&quot; when
                adding an expense to create one.
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {templates.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 py-3">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => onUse(t)}
                  >
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">{t.name}</p>
                      {t.recurrence_hint && (
                        <Badge variant="secondary" className="shrink-0 text-xs">
                          {RECURRENCE_LABEL[t.recurrence_hint] ?? t.recurrence_hint}
                        </Badge>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {t.description} · {formatCurrency(t.default_amount)}
                      {t.job?.name ? ` · ${t.job.name}` : ""}
                    </p>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title="Edit"
                      onClick={() => setEditing(t)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      title="Delete"
                      onClick={() => handleDelete(t.id)}
                      disabled={deletingId === t.id}
                    >
                      {deletingId === t.id ? (
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
        </DialogContent>
      </Dialog>

      <ExpenseTemplateEditDialog
        key={editing?.id ?? "none"}
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(null)}
        template={editing}
        existingJobs={existingJobs}
        onSaved={(updated) => {
          onUpdated(updated);
          setEditing(null);
        }}
      />
    </>
  );
}
