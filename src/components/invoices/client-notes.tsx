// The client-facing "Notes" block, shown after the totals wherever a document is displayed to anyone
// (owner detail page, preview panels, the public sign / invoice pages and the portals). It only ever
// receives `notes`; the owner-only internal notes never go through this component.
export function ClientNotes({ notes, compact = false }: { notes?: string | null; compact?: boolean }) {
  const text = notes?.trim();
  if (!text) return null;
  return (
    <div className={compact ? "mt-3 text-[11px]" : "text-sm"}>
      <p className="text-xs text-muted-foreground uppercase">Notes</p>
      <p className="whitespace-pre-line">{text}</p>
    </div>
  );
}
