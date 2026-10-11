import { MAX_CAPTION_LENGTH, MAX_DISPLAY_BYTES, MAX_THUMB_BYTES } from "./photo-config.ts";
import { hasMetadataSegment, isJpeg } from "./jpeg-check.ts";

// Pure rules for site photos (no database, no browser) so they are tested directly. The routes in
// app/api/job-photos supply the data and do the I/O.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

// Both files of one photo live in the owner's own folder. The first path segment is the user id, which
// is exactly what the storage policies check.
export function photoPaths(userId: string, photoId: string): { storage_path: string; thumb_path: string } {
  return {
    storage_path: `${userId}/${photoId}.jpg`,
    thumb_path: `${userId}/${photoId}_thumb.jpg`,
  };
}

// A list of photo ids from a request body: 1..max real uuids, de-duplicated. Anything else is an error.
export const MAX_BULK_PHOTOS = 100;

export function parseIdList(raw: unknown, max = MAX_BULK_PHOTOS): { ok: true; ids: string[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "Choose at least one photo." };
  if (raw.length > max) return { ok: false, error: `Choose at most ${max} photos at a time.` };
  if (!raw.every(isUuid)) return { ok: false, error: "Invalid photo." };
  return { ok: true, ids: [...new Set(raw as string[])] };
}

export function pathBelongsTo(userId: string, path: string): boolean {
  return path.startsWith(`${userId}/`) && !path.slice(userId.length + 1).includes("/") && !path.includes("..");
}

// Blank is stored as null. Returns an error message for anything over the limit.
export function parseCaption(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, error: "Caption must be text." };
  const text = raw.trim();
  if (!text) return { ok: true, value: null };
  if (text.length > MAX_CAPTION_LENGTH) {
    return { ok: false, error: `Captions can be at most ${MAX_CAPTION_LENGTH} characters.` };
  }
  return { ok: true, value: text };
}

// The job a photo is filed under: a real uuid, or null for Unsorted. "" and "unsorted" mean Unsorted.
export function parseJobRef(raw: unknown): { ok: true; jobId: string | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, jobId: null };
  if (typeof raw !== "string") return { ok: false, error: "Invalid job." };
  const text = raw.trim();
  if (text === "" || text.toLowerCase() === "unsorted") return { ok: true, jobId: null };
  if (!isUuid(text)) return { ok: false, error: "Invalid job." };
  return { ok: true, jobId: text };
}

// The photo's real date if the client sent a sane one, never in the future, else now.
export function parseTakenAt(raw: unknown, now: Date = new Date()): string {
  if (typeof raw !== "string" || !raw) return now.toISOString();
  const t = new Date(raw);
  if (Number.isNaN(t.getTime()) || t.getTime() > now.getTime() || t.getFullYear() < 2000) {
    return now.toISOString();
  }
  return t.toISOString();
}

export interface UploadedFile {
  type: string;
  size: number;
  bytes: Uint8Array;
}

// Type, size and contents of the two files. Trusts neither the declared MIME type nor the extension:
// the bytes must be a JPEG with no EXIF/XMP/IPTC/comment segment (the client strips them; this proves it).
export function validatePhotoFiles(photo: UploadedFile | null, thumb: UploadedFile | null): string | null {
  if (!photo || !thumb) return "Both the photo and its thumbnail are required.";
  for (const [label, file, max] of [
    ["photo", photo, MAX_DISPLAY_BYTES],
    ["thumbnail", thumb, MAX_THUMB_BYTES],
  ] as const) {
    if (file.size <= 0 || file.bytes.length === 0) return `The ${label} is empty.`;
    if (file.size > max || file.bytes.length > max) {
      return `The ${label} is too large (limit ${Math.round(max / 1024)} KB). Photos are shrunk on your device first.`;
    }
    if (file.type !== "image/jpeg" || !isJpeg(file.bytes)) return `The ${label} must be a JPEG image.`;
    if (hasMetadataSegment(file.bytes)) {
      return `The ${label} still carries metadata (such as location). Photos are cleaned on your device first.`;
    }
  }
  return null;
}
