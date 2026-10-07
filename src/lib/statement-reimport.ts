// The refusal shown when the same statement file is uploaded again ("ALREADY_IMPORTED"), and what a
// re-import would do. Pure, so the wording and the "when is Re-import offered" rule are unit-tested.

import { summarizeLines, type ImportSummary, type SummaryLine } from "./statement-summary.ts";

export interface AlreadyImportedInfo {
  import_id: string;
  /** When the statement was saved (ISO). */
  imported_at: string;
  created: number;
  created_remaining: number;
  free: { excluded: number; released: number; total: number };
  /** Re-import is offered only when at least one line is free (payment lines never are). */
  can_reimport: boolean;
  cap: { used: number; cap: number | null };
}

export function dayLabel(iso: string): string {
  // Toronto's calendar day, in words ("Oct 7, 2026"), so it matches what the owner sees elsewhere.
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Toronto",
  });
}

export function alreadyImportedInfo(
  importId: string,
  importedAt: string,
  lines: SummaryLine[],
  cap: { used: number; cap: number | null },
): AlreadyImportedInfo {
  const s: ImportSummary = summarizeLines(lines);
  return {
    import_id: importId,
    imported_at: importedAt,
    created: s.created,
    created_remaining: s.created_remaining,
    free: s.free,
    can_reimport: s.free.total > 0,
    cap,
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// "This statement was imported on Oct 7, 2026. 2 of its 4 expenses still exist."
export function alreadyImportedMessage(info: AlreadyImportedInfo): string {
  const when = `This statement was imported on ${dayLabel(info.imported_at)}.`;
  const { created, created_remaining: remaining } = info;
  if (created === 0) return `${when} None of its lines became expenses that still exist.`;
  if (created === 1) return remaining === 1 ? `${when} Its 1 expense still exists.` : `${when} Its 1 expense no longer exists.`;
  if (remaining === 0) return `${when} None of its ${created} expenses still exist.`;
  if (remaining === created) return `${when} All ${created} of its expenses still exist.`;
  return `${when} ${remaining} of its ${created} expenses still exist.`;
}

// The re-import dialog's statement of what it brings back, in the owner's words.
export function reimportBringsBack(free: AlreadyImportedInfo["free"]): string {
  const parts: string[] = [];
  if (free.excluded > 0) parts.push(`${plural(free.excluded, "line")} you excluded`);
  if (free.released > 0) parts.push(`${plural(free.released, "line")} whose expense was deleted`);
  return parts.length ? `Re-importing brings back ${parts.join(" and ")}.` : "";
}

// "This uses 1 of your 3 imports this month (2 used)."
export function capNote(cap: AlreadyImportedInfo["cap"]): string {
  if (cap.cap === null) return "A re-import reads the statement again and counts toward your monthly imports.";
  const left = Math.max(cap.cap - cap.used, 0);
  return left > 0
    ? `A re-import counts toward your monthly imports: it uses 1 of your ${cap.cap} (${cap.used} used so far this month).`
    : `You've used all ${cap.cap} of your imports this month, so a re-import isn't possible until next month.`;
}

export const capAllowsReimport = (cap: AlreadyImportedInfo["cap"]) => cap.cap === null || cap.used < cap.cap;
