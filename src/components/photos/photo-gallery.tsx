"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, FolderInput, Loader2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PHOTOS_CHANGED_EVENT } from "@/components/photos/add-photos-dialog";
import type { SignedPhoto } from "@/lib/job-photos-server";

// Thumbnail grid for one job's photos (`jobId`) or the Unsorted pile (`jobId` null), with a full-size
// viewer (arrows / swipe, caption, move, delete, close). Photos come from /api/job-photos as short-lived
// signed URLs; when one lapses the image fails to load and the list is fetched again for fresh URLs.

interface Usage {
  current: number;
  limit: number | null;
}

const UNSORTED_VALUE = "__unsorted__";

export function PhotoGallery({
  jobId,
  empty,
}: {
  jobId: string | null;
  // Shown when there are no photos (text, or a richer empty state).
  empty: React.ReactNode;
}) {
  const [photos, setPhotos] = useState<SignedPhoto[] | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [failed, setFailed] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const refreshedOnError = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/job-photos?job_id=${jobId ?? "unsorted"}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { photos: SignedPhoto[]; usage: Usage };
      setPhotos(data.photos);
      setUsage(data.usage);
      setFailed(false);
      refreshedOnError.current = false;
    } catch {
      setFailed(true);
    }
  }, [jobId]);

  // Always fetched on mount (never trusted from a router cache), and again after an upload.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the fetch is async; state is set after it resolves
    void load();
    const onChanged = () => void load();
    window.addEventListener(PHOTOS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(PHOTOS_CHANGED_EVENT, onChanged);
  }, [load]);

  // A signed URL that has expired fails to load: ask once for fresh ones.
  function handleImageError() {
    if (refreshedOnError.current) return;
    refreshedOnError.current = true;
    void load();
  }

  function removeLocal(id: string) {
    setPhotos((prev) => (prev ? prev.filter((p) => p.id !== id) : prev));
    setUsage((u) => (u ? { ...u, current: Math.max(0, u.current - 1) } : u));
  }

  if (failed && !photos) {
    return (
      <p className="text-sm text-muted-foreground">
        Couldn&apos;t load photos.{" "}
        <button type="button" className="underline underline-offset-2" onClick={() => void load()}>
          Try again
        </button>
      </p>
    );
  }
  if (!photos) {
    return (
      <div className="flex h-24 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (photos.length === 0) return typeof empty === "string" ? <p className="text-sm text-muted-foreground">{empty}</p> : <>{empty}</>;

  return (
    <div className="space-y-2">
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {photos.map((p, i) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => setViewing(i)}
              aria-label={p.caption ? `Open photo: ${p.caption}` : "Open photo"}
              className="block aspect-square w-full overflow-hidden rounded-lg bg-muted"
            >
              {p.thumb_url && (
                // eslint-disable-next-line @next/next/no-img-element -- a private, short-lived signed URL
                <img
                  src={p.thumb_url}
                  alt={p.caption ?? ""}
                  loading="lazy"
                  onError={handleImageError}
                  className="h-full w-full object-cover"
                />
              )}
            </button>
          </li>
        ))}
      </ul>
      {usage && usage.limit !== null && (
        <p className="text-xs text-muted-foreground">
          {usage.current} of {usage.limit} photos used on your plan.
        </p>
      )}

      {viewing !== null && photos[viewing] && (
        <Viewer
          photos={photos}
          index={viewing}
          currentJobId={jobId}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
          onImageError={handleImageError}
          onRemoved={(id) => {
            removeLocal(id);
            setViewing((cur) => {
              if (cur === null) return null;
              const left = photos.length - 1;
              return left <= 0 ? null : Math.min(cur, left - 1);
            });
          }}
        />
      )}
    </div>
  );
}

type Mode = "view" | "confirm-delete" | "move";

function Viewer({
  photos,
  index,
  currentJobId,
  onIndex,
  onClose,
  onImageError,
  onRemoved,
}: {
  photos: SignedPhoto[];
  index: number;
  currentJobId: string | null;
  onIndex: (i: number) => void;
  onClose: () => void;
  onImageError: () => void;
  onRemoved: (id: string) => void;
}) {
  const router = useRouter();
  const photo = photos[index];
  const [mode, setMode] = useState<Mode>("view");
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<{ id: string; name: string }[] | null>(null);
  const [target, setTarget] = useState<string>("");
  const touchX = useRef<number | null>(null);

  const go = useCallback(
    (delta: number) => {
      const next = index + delta;
      if (next < 0 || next >= photos.length) return;
      setMode("view");
      onIndex(next);
    },
    [index, photos.length, onIndex],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (mode !== "view") return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, mode]);

  async function openMove() {
    setMode("move");
    setTarget("");
    if (jobs) return;
    try {
      const res = await fetch("/api/jobs");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setJobs((data.jobs as { id: string; name: string }[]).map((j) => ({ id: j.id, name: j.name })));
    } catch {
      toast.error("Couldn't load your jobs.");
      setMode("view");
    }
  }

  const moveItems = useMemo(() => {
    // Unsorted is a destination only for a photo that is in a job already.
    const map: Record<string, string> = currentJobId === null ? {} : { [UNSORTED_VALUE]: "Unsorted" };
    for (const j of jobs ?? []) if (j.id !== currentJobId) map[j.id] = j.name;
    return map;
  }, [jobs, currentJobId]);

  async function handleMove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/job-photos/${photo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: target === UNSORTED_VALUE ? null : target }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't move the photo.");
      toast.success(`Moved to ${moveItems[target] ?? "Unsorted"}`);
      window.dispatchEvent(new Event(PHOTOS_CHANGED_EVENT));
      router.refresh(); // the Photos tab's unsorted count
      // It no longer belongs in this list.
      onRemovedLocalOnly();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't move the photo.");
    } finally {
      setBusy(false);
    }
  }

  // After a move the photo is in a different list; drop it here without calling delete.
  function onRemovedLocalOnly() {
    setMode("view");
    onRemoved(photo.id);
  }

  async function handleDelete() {
    setBusy(true);
    try {
      const res = await fetch(`/api/job-photos/${photo.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't delete the photo.");
      toast.success("Photo deleted");
      window.dispatchEvent(new Event(PHOTOS_CHANGED_EVENT));
      router.refresh(); // the Photos tab's unsorted count
      setMode("view");
      onRemoved(photo.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete the photo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="top-0 left-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none bg-black p-0 text-white ring-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">Photo {index + 1} of {photos.length}</DialogTitle>
        <DialogDescription className="sr-only">
          Use the arrow keys or swipe to move between photos.
        </DialogDescription>

        <div className="flex items-center justify-between px-3 py-2 text-sm">
          <span className="tabular-nums text-white/70">
            {index + 1} / {photos.length}
          </span>
          <Button variant="ghost" size="icon" aria-label="Close" className="text-white hover:bg-white/10" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div
          className="relative flex min-h-0 flex-1 items-center justify-center"
          onTouchStart={(e) => {
            touchX.current = e.touches[0].clientX;
          }}
          onTouchEnd={(e) => {
            if (touchX.current === null) return;
            const dx = e.changedTouches[0].clientX - touchX.current;
            touchX.current = null;
            if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
          }}
        >
          {photo.url ? (
            // eslint-disable-next-line @next/next/no-img-element -- a private, short-lived signed URL
            <img
              key={photo.id}
              src={photo.url}
              alt={photo.caption ?? ""}
              onError={onImageError}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <p className="text-sm text-white/70">This photo couldn&apos;t be loaded.</p>
          )}
          {index > 0 && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous photo"
              className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/40 text-white hover:bg-black/60"
              onClick={() => go(-1)}
            >
              <ChevronLeft className="h-6 w-6" />
            </Button>
          )}
          {index < photos.length - 1 && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next photo"
              className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/40 text-white hover:bg-black/60"
              onClick={() => go(1)}
            >
              <ChevronRight className="h-6 w-6" />
            </Button>
          )}
        </div>

        <div className="space-y-2 px-4 py-3">
          {photo.caption && <p className="text-sm">{photo.caption}</p>}
          <p className="text-xs text-white/60">
            {new Date(photo.taken_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </p>

          {mode === "view" && (
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={openMove}>
                <FolderInput className="mr-1.5 h-4 w-4" />
                Move
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setMode("confirm-delete")}>
                <Trash2 className="mr-1.5 h-4 w-4" />
                Delete
              </Button>
            </div>
          )}

          {mode === "confirm-delete" && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">Delete this photo for good?</span>
              <Button size="sm" variant="destructive" disabled={busy} onClick={handleDelete}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setMode("view")}>
                Cancel
              </Button>
            </div>
          )}

          {mode === "move" && (
            <div className="flex flex-wrap items-center gap-2 text-foreground">
              <div className="w-56">
                <Select items={moveItems} value={target || null} onValueChange={(v) => v && setTarget(v)}>
                  <SelectTrigger aria-label="Move to" className="w-full bg-background">
                    <SelectValue placeholder="Choose a job" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(moveItems).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" disabled={busy || !jobs || !target} onClick={handleMove}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Move"}
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setMode("view")}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
