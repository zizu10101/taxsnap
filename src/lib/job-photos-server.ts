import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import { PHOTO_BUCKET, PHOTO_URL_EXPIRY_SECONDS } from "./photo-config.ts";

// Server-side photo plumbing shared by the job-photos routes and the delete-job route. Everything takes
// the signed-in user's id and filters on it explicitly, on top of row-level security.

// The slice of Supabase Storage these helpers use, so tests can pass a fake.
export interface PhotoStorage {
  from(bucket: string): {
    remove(paths: string[]): Promise<{ error: { message: string } | null }>;
  };
}

export interface PhotoPathRow {
  storage_path: string;
  thumb_path: string;
}

// Every file behind these rows: the display image AND the thumbnail of each.
export function filePaths(rows: PhotoPathRow[]): string[] {
  return rows.flatMap((r) => [r.storage_path, r.thumb_path]);
}

// Removes the files. Returns false (and logs only the message, never a path or user id) when storage
// refused, so the caller can report it; the rows are already gone by then, so the worst case is an
// unreachable file, never a row pointing at nothing.
export async function removePhotoFiles(storage: PhotoStorage, rows: PhotoPathRow[]): Promise<boolean> {
  const paths = filePaths(rows);
  if (paths.length === 0) return true;
  const { error } = await storage.from(PHOTO_BUCKET).remove(paths);
  if (error) {
    console.error("[job-photos] could not remove files", { files: paths.length, error: error.message });
    return false;
  }
  return true;
}

type Db = SupabaseClient<Database>;

// The paths of a job's photos, read BEFORE the job is deleted (deleting the job cascades the rows away).
export async function listJobPhotoPaths(db: Db, userId: string, jobId: string): Promise<PhotoPathRow[]> {
  const { data, error } = await db
    .from("job_photos")
    .select("storage_path, thumb_path")
    .eq("user_id", userId)
    .eq("job_id", jobId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

// Deletes one of the user's photos: the row first, then both files. null = not this user's photo.
export async function deletePhoto(
  db: Db,
  storage: PhotoStorage,
  userId: string,
  photoId: string,
): Promise<{ filesRemoved: boolean } | null> {
  const { data: row, error } = await db
    .from("job_photos")
    .select("id, storage_path, thumb_path")
    .eq("id", photoId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return null;

  const { error: deleteError } = await db
    .from("job_photos")
    .delete()
    .eq("id", photoId)
    .eq("user_id", userId);
  if (deleteError) throw new Error(deleteError.message);

  return { filesRemoved: await removePhotoFiles(storage, [row]) };
}

export interface BulkDeleteResult {
  // Rows that are gone (and, unless listed in filesLeft, both of their files).
  deleted: string[];
  // Photos whose row was deleted but whose file(s) storage refused to remove: reported, never hidden.
  filesLeft: string[];
  // Photos that were not deleted at all, with why.
  failed: { id: string; reason: "not_found" | "error" }[];
}

// Deletes photos ONE AT A TIME (row, then both files, via deletePhoto), so one failure never stops or
// hides the rest. Every id ends up in exactly one of deleted / failed. Scoped to the user by deletePhoto.
export async function deletePhotos(
  db: Db,
  storage: PhotoStorage,
  userId: string,
  ids: string[],
): Promise<BulkDeleteResult> {
  const result: BulkDeleteResult = { deleted: [], filesLeft: [], failed: [] };
  for (const id of ids) {
    try {
      const outcome = await deletePhoto(db, storage, userId, id);
      if (!outcome) {
        result.failed.push({ id, reason: "not_found" });
        continue;
      }
      result.deleted.push(id);
      if (!outcome.filesRemoved) result.filesLeft.push(id);
    } catch (err) {
      console.error("[job-photos] delete failed", { error: err instanceof Error ? err.message : String(err) });
      result.failed.push({ id, reason: "error" });
    }
  }
  return result;
}

// Moves the user's photos to a job (or to Unsorted with null). The caller has already checked the job is
// the user's. Returns which ids moved and which were not found (not theirs, or already gone).
export async function movePhotos(
  db: Db,
  userId: string,
  ids: string[],
  jobId: string | null,
): Promise<{ moved: string[]; notFound: string[] }> {
  const { data, error } = await db
    .from("job_photos")
    .update({ job_id: jobId })
    .in("id", ids)
    .eq("user_id", userId)
    .select("id");
  if (error) throw new Error(error.message);
  const moved = (data ?? []).map((r) => r.id);
  return { moved, notFound: ids.filter((id) => !moved.includes(id)) };
}

export interface SignedPhoto {
  id: string;
  job_id: string | null;
  caption: string | null;
  taken_at: string;
  thumb_url: string | null;
  url: string | null;
}

// Short-lived signed URLs for a list of the user's photos (the bucket is private; there is no public URL).
export async function signPhotos(
  storage: Db["storage"],
  rows: (PhotoPathRow & Omit<SignedPhoto, "thumb_url" | "url">)[],
): Promise<SignedPhoto[]> {
  if (rows.length === 0) return [];
  const paths = filePaths(rows);
  const { data } = await storage.from(PHOTO_BUCKET).createSignedUrls(paths, PHOTO_URL_EXPIRY_SECONDS);
  const urlByPath = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
  return rows.map((r) => ({
    id: r.id,
    job_id: r.job_id,
    caption: r.caption,
    taken_at: r.taken_at,
    url: urlByPath.get(r.storage_path) ?? null,
    thumb_url: urlByPath.get(r.thumb_path) ?? null,
  }));
}
