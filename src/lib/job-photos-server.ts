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
