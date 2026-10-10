// Rules for a document's two note fields (migration 0062): `notes` is client-facing, `internal_notes`
// is owner-only. Pure, so they are tested.

export const MAX_NOTES_LENGTH = 4000; // matches the 0062 check constraints

export type ParsedNote =
  | { ok: true; value: string | null | undefined }
  | { ok: false; error: string };

/** undefined = not sent (leave as is); blank/null = clear (stored as null, never ""); else trimmed. */
export function parseNote(raw: unknown, label: string): ParsedNote {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, error: `${label} must be text.` };
  const trimmed = raw.trim();
  if (trimmed.length > MAX_NOTES_LENGTH) {
    return { ok: false, error: `${label} must be ${MAX_NOTES_LENGTH} characters or fewer.` };
  }
  return { ok: true, value: trimmed === "" ? null : trimmed };
}

export const NOTES_LABEL = "Notes to client";
export const INTERNAL_NOTES_LABEL = "Internal notes";
