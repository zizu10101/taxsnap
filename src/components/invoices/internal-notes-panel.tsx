"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, NotebookPen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MAX_NOTES_LENGTH } from "@/lib/document-notes";
import type { DocumentWithRelations } from "@/lib/database.types";

// OWNER-ONLY. The editable internal notes on the document detail page, in the right-hand panel. It
// saves with PATCH /api/documents/[id] sending ONLY internal_notes (blank is stored as null by the
// server), and stays editable after the document is sent - the route keeps internal_notes out of the
// locked content keys. Never printed (print:hidden), and never part of the PDF, the public pages, the
// portals or an email. The "notepad" look is the .notepad class in globals.css (lg and up).
export function InternalNotesPanel({
  documentId,
  initial,
  onSaved,
}: {
  documentId: string;
  initial: string | null;
  onSaved: (internalNotes: string | null) => void;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial?.trim() ?? "");
  const [text, setText] = useState(initial ?? "");
  const [saving, setSaving] = useState(false);
  const dirty = text.trim() !== saved;

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ internal_notes: text.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save internal notes");
      const value = (data.document?.internal_notes as string | null | undefined) ?? null;
      setSaved(value?.trim() ?? "");
      setText(value ?? "");
      onSaved(value);
      toast.success("Internal notes saved");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save internal notes");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <NotebookPen className="h-4 w-4 text-muted-foreground" />
          Internal notes
        </CardTitle>
        <p className="text-xs text-muted-foreground">Internal (only you see this)</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <textarea
          aria-label="Internal notes"
          className="notepad"
          maxLength={MAX_NOTES_LENGTH}
          placeholder="Private notes about this job or client"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={handleSave} disabled={!dirty || saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
