// Pure helpers for how a document line (and a saved item) is labelled: a short NAME (shown bold), an
// optional longer DESCRIPTION under it, and an optional UNIT of measure next to the quantity.
//
// Old data keeps working without a backfill: before migration 0061 a line had only `description`.
// A row whose `name` is null is such a row - its old description IS the name, with an empty
// description (lineName / lineDescription). New rows always store a name.

export interface LineLabelFields {
  name?: string | null;
  description?: string | null;
  unit?: string | null;
}

/** The units offered in the pickers, in order. Anything else a line carries is a free-text "other". */
export const UNIT_PRESETS = ["each", "hr", "day", "sq ft", "linear ft", "m", "yd"] as const;

/** Select value that means "type my own unit". */
export const OTHER_UNIT = "__other__";

export const UNIT_MAX_LENGTH = 20;
export const UNIT_TOO_LONG_MESSAGE = `Unit must be ${UNIT_MAX_LENGTH} characters or fewer.`;

/** The line's name: its own name, or - for a line from before names existed - its old description. */
export function lineName(item: LineLabelFields): string {
  const name = item.name;
  if (name !== null && name !== undefined) return name.trim();
  return (item.description ?? "").trim();
}

/** The line's longer description; empty for an old line (its description became the name). */
export function lineDescription(item: LineLabelFields): string {
  if (item.name === null || item.name === undefined) return "";
  return (item.description ?? "").trim();
}

/** Name and description as one string, for places that only have room for text (search, change orders). */
export function lineText(item: LineLabelFields): string {
  const name = lineName(item);
  const description = lineDescription(item);
  return description ? `${name} - ${description}` : name;
}

/** A unit as stored: trimmed, blank = none (null). */
export function normalizeUnit(unit: unknown): string | null {
  if (typeof unit !== "string") return null;
  const trimmed = unit.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed : null;
}

/** Null when fine, otherwise the message for a unit that can't be stored. */
export function unitError(unit: unknown): string | null {
  const normalized = normalizeUnit(unit);
  if (normalized && normalized.length > UNIT_MAX_LENGTH) return UNIT_TOO_LONG_MESSAGE;
  return null;
}

/** True when the stored unit is set and isn't one of the presets (the "other" free-text case). */
export function isCustomUnit(unit: string | null | undefined): boolean {
  const normalized = normalizeUnit(unit);
  return normalized !== null && !(UNIT_PRESETS as readonly string[]).includes(normalized);
}

/** The Select value for a stored unit: "" (none), a preset, or OTHER_UNIT. */
export function unitSelectValue(unit: string | null | undefined): string {
  const normalized = normalizeUnit(unit);
  if (normalized === null) return "";
  return isCustomUnit(normalized) ? OTHER_UNIT : normalized;
}

/** The quantity as text: whole numbers plain, otherwise up to two decimals without trailing zeros. */
export function formatQuantityNumber(quantity: number): string {
  const q = Number(quantity);
  if (!Number.isFinite(q)) return "0";
  return String(Math.round(q * 100) / 100);
}

/** "3", or "3 hr" when the line has a unit. A blank unit looks exactly like it always did. */
export function formatQuantity(quantity: number, unit?: string | null): string {
  const text = formatQuantityNumber(quantity);
  const u = normalizeUnit(unit);
  return u ? `${text} ${u}` : text;
}

export interface LineInput {
  name?: unknown;
  description?: unknown;
  unit?: unknown;
}

/**
 * Reads the name / description / unit of one line in a request body. A body that only has the old
 * `description` (an older client, a saved tab) is read as name = description with no description,
 * the same meaning as an old stored row. Returns null for a line with no name (it is dropped).
 */
export function readLineLabels(
  input: LineInput,
): { name: string; description: string; unit: string | null } | null {
  const hasName = typeof input.name === "string";
  const name = (hasName ? (input.name as string) : typeof input.description === "string" ? (input.description as string) : "").trim();
  if (!name) return null;
  const description = hasName && typeof input.description === "string" ? input.description.trim() : "";
  return { name, description, unit: normalizeUnit(input.unit) };
}

export interface ParsedLine {
  name: string;
  description: string;
  unit: string | null;
  quantity: number;
  unit_price: number;
}

/**
 * Reads the `items` of a document request body: lines with no name are dropped (as lines with no
 * description always were), a unit over the length limit is refused with its message.
 */
export function parseLineInputs(items: unknown): { lines: ParsedLine[] } | { error: string } {
  if (!Array.isArray(items)) return { lines: [] };
  const lines: ParsedLine[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as LineInput & { quantity?: unknown; unit_price?: unknown };
    const labels = readLineLabels(r);
    if (!labels) continue;
    const problem = unitError(r.unit);
    if (problem) return { error: problem };
    lines.push({
      ...labels,
      quantity: Number(r.quantity) || 0,
      unit_price: Number(r.unit_price) || 0,
    });
  }
  return { lines };
}

// ---- Send menu rules ----

export type SendAction = "email" | "copy-link" | "download-pdf";

export interface SendOption {
  action: SendAction;
  label: string;
}

export const NO_CLIENT_EMAIL_NOTE = "Email to client is hidden: this client has no email on file. Add one on the client's page.";

/**
 * What the Send menu shows. "Email to client" is HIDDEN when the client has no email, and `note` says
 * why (so the missing option isn't a mystery). Sending never changes the document's status - that is a
 * separate decision - so nothing here carries one.
 */
export function sendMenu(opts: { clientEmail: string | null | undefined }): {
  options: SendOption[];
  note: string | null;
} {
  const hasEmail = !!opts.clientEmail?.trim();
  const options: SendOption[] = [
    ...(hasEmail ? [{ action: "email" as const, label: "Email to client" }] : []),
    { action: "copy-link", label: "Copy link" },
    { action: "download-pdf", label: "Download PDF" },
  ];
  return { options, note: hasEmail ? null : NO_CLIENT_EMAIL_NOTE };
}
