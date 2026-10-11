"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, FolderInput, Loader2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PHOTOS_CHANGED_EVENT } from "@/components/photos/add-photos-dialog";
import type { BulkDeleteResult, SignedPhoto } from "@/lib/job-photos-server";

// Thumbnail grid for one job's photos (`jobId`) or the Unsorted pile (`jobId` null), with a full-size
// viewer (arrows / swipe, caption, move, delete, close). Photos come from /api/job-photos as short-lived
// signed URLs; when one lapses the image fails to load and the list is fetched again for fresh URLs.
//
// Deleting: every thumbnail has its own trash button (always visible, not hover-only) and the viewer has
// Delete; both ask first with the same ConfirmDialog. "Select" turns the grid into a multi-select with
// Select all, Move to job... and Delete (n). All deletes go through POST /api/job-photos/bulk, which
// removes each photo's row and BOTH files one at a time and reports every outcome.

interface Usage {
  current: number;
  limit: number | null;
}

const UNSORTED_VALUE = "__unsorted__";

const plural = (n: number) => `${n} photo${n === 1 ? "" : "s"}`;

export function PhotoGallery({
  jobId,
  empty,
}: {
  jobId: string | null;
  // Shown when there are no photos (text, or a richer empty state).
  empty: React.ReactNode;
}) {
  const router = useRouter();
  const [photos, setPhotos] = useState<SignedPhoto[] | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [failed, setFailed] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // The delete being confirmed: which photos, and the viewer position to return to if cancelled.
  const [confirm, setConfirm] = useState<{ ids: string[]; reopen: number | null } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [moveJobs, setMoveJobs] = useState<{ id: string; name: string }[] | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
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

  // Photos that left this list (deleted, or moved to another job): drop them from the grid and the
  // selection without a reload, then let the rest of the page (the nav's unsorted badge) catch up.
  function removeLocal(ids: string[]) {
    const gone = new Set(ids);
    setPhotos((prev) => (prev ? prev.filter((p) => !gone.has(p.id)) : prev));
    setSelected((prev) => new Set([...prev].filter((id) => !gone.has(id))));
    setUsage((u) => (u ? { ...u, current: Math.max(0, u.current - ids.length) } : u));
  }

  function announceChange() {
    window.dispatchEvent(new Event(PHOTOS_CHANGED_EVENT));
    router.refresh();
  }

  function askDelete(ids: string[], reopen: number | null = null) {
    if (ids.length === 0) return;
    setConfirm({ ids, reopen });
  }

  function cancelDelete() {
    if (deleting || !confirm) return;
    const back = confirm.reopen;
    setConfirm(null);
    // Cancelled from the viewer: put the person back on the photo they were looking at.
    if (back !== null) setViewing(Math.min(back, Math.max(0, (photos?.length ?? 1) - 1)));
  }

  async function performDelete() {
    if (!confirm) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/job-photos/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", ids: confirm.ids }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<BulkDeleteResult> & { error?: string };
      if (!res.ok) throw new Error(data.error || "Couldn't delete the photos.");

      const deleted = data.deleted ?? [];
      const filesLeft = data.filesLeft ?? [];
      const notDeleted = data.failed ?? [];
      removeLocal(deleted);

      if (deleted.length > 0) toast.success(`Deleted ${plural(deleted.length)}`);
      if (filesLeft.length > 0) {
        toast.warning(
          `${plural(filesLeft.length)} deleted, but ${filesLeft.length === 1 ? "its" : "their"} image files couldn't be cleaned up.`,
        );
      }
      if (notDeleted.length > 0) {
        toast.error(`${plural(notDeleted.length)} couldn't be deleted. They're still here - try again.`);
      }
      if (deleted.length > 0) announceChange();
      setConfirm(null);
      // Back out of select mode once nothing is left selected.
      if (notDeleted.length === 0) setSelecting(false);
    } catch (err) {
      // A failed request leaves the dialog open for another try.
      toast.error(err instanceof Error ? err.message : "Couldn't delete the photos.");
    } finally {
      setDeleting(false);
    }
  }

  async function openBulkMove() {
    if (selected.size === 0) return;
    setMoveOpen(true);
    if (moveJobs) return;
    try {
      const res = await fetch("/api/jobs");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMoveJobs((data.jobs as { id: string; name: string }[]).map((j) => ({ id: j.id, name: j.name })));
    } catch {
      toast.error("Couldn't load your jobs.");
      setMoveOpen(false);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function endSelecting() {
    setSelecting(false);
    setSelected(new Set());
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
  if (photos.length === 0) {
    return typeof empty === "string" ? <p className="text-sm text-muted-foreground">{empty}</p> : <>{empty}</>;
  }

  const allSelected = selected.size === photos.length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {selecting ? (
          <>
            <span className="mr-auto text-sm text-muted-foreground tabular-nums">
              {selected.size} selected
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelected(allSelected ? new Set() : new Set(photos.map((p) => p.id)))}
            >
              {allSelected ? "Clear" : `Select all (${photos.length})`}
            </Button>
            <Button variant="outline" size="sm" disabled={selected.size === 0} onClick={openBulkMove}>
              <FolderInput className="mr-1.5 h-4 w-4" />
              Move to job...
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={selected.size === 0}
              onClick={() => askDelete([...selected])}
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              Delete{selected.size > 0 ? ` (${selected.size})` : ""}
            </Button>
            <Button variant="ghost" size="sm" onClick={endSelecting}>
              Cancel
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setSelecting(true)}>
            Select
          </Button>
        )}
      </div>

      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {photos.map((p, i) => {
          const isSelected = selected.has(p.id);
          return (
            <li key={p.id} className="relative">
              <button
                type="button"
                onClick={() => (selecting ? toggle(p.id) : setViewing(i))}
                aria-label={
                  selecting
                    ? `${isSelected ? "Deselect" : "Select"} photo`
                    : p.caption
                      ? `Open photo: ${p.caption}`
                      : "Open photo"
                }
                className={`block aspect-square w-full overflow-hidden rounded-lg bg-muted ${
                  isSelected ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""
                }`}
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
              {selecting ? (
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => toggle(p.id)}
                  aria-label="Select photo"
                  className="absolute top-1.5 left-1.5 size-5 border-white bg-black/40"
                />
              ) : (
                // Always visible (touch has no hover), small, bottom-right so it stays out of the way.
                <button
                  type="button"
                  aria-label="Delete photo"
                  onClick={() => askDelete([p.id])}
                  className="absolute right-1 bottom-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          );
        })}
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
          // Deleting from the viewer closes it first (one modal at a time), asks in the same
          // ConfirmDialog as the grid, and comes back here if cancelled.
          onRequestDelete={() => {
            const at = viewing;
            setViewing(null);
            askDelete([photos[at].id], at);
          }}
          onMoved={(id) => {
            removeLocal([id]);
            announceChange();
            setViewing((cur) => {
              if (cur === null) return null;
              const left = photos.length - 1;
              return left <= 0 ? null : Math.min(cur, left - 1);
            });
          }}
        />
      )}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) cancelDelete();
        }}
        title={confirm && confirm.ids.length > 1 ? `Delete ${plural(confirm.ids.length)}?` : "Delete this photo?"}
        description={
          confirm && confirm.ids.length > 1
            ? "This can't be undone. The photos and their thumbnails are removed for good."
            : "This can't be undone."
        }
        loading={deleting}
        onConfirm={performDelete}
      />

      {moveOpen && (
        <BulkMoveDialog
          ids={[...selected]}
          currentJobId={jobId}
          jobs={moveJobs}
          onClose={() => setMoveOpen(false)}
          onMoved={(movedIds) => {
            removeLocal(movedIds);
            announceChange();
            setMoveOpen(false);
            setSelecting(false);
          }}
        />
      )}
    </div>
  );
}

// Move several selected photos to one job (or to Unsorted, when they are in a job now).
function BulkMoveDialog({
  ids,
  currentJobId,
  jobs,
  onClose,
  onMoved,
}: {
  ids: string[];
  currentJobId: string | null;
  jobs: { id: string; name: string }[] | null;
  onClose: () => void;
  onMoved: (movedIds: string[]) => void;
}) {
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);

  const items = useMemo(() => {
    const map: Record<string, string> = currentJobId === null ? {} : { [UNSORTED_VALUE]: "Unsorted" };
    for (const j of jobs ?? []) if (j.id !== currentJobId) map[j.id] = j.name;
    return map;
  }, [jobs, currentJobId]);

  async function handleMove() {
    setBusy(true);
    try {
      const res = await fetch("/api/job-photos/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "move", ids, job_id: target === UNSORTED_VALUE ? null : target }),
      });
      const data = (await res.json().catch(() => ({}))) as { moved?: string[]; notFound?: string[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Couldn't move the photos.");
      const moved = data.moved ?? [];
      if (moved.length > 0) toast.success(`Moved ${plural(moved.length)} to ${items[target] ?? "Unsorted"}`);
      if ((data.notFound ?? []).length > 0) {
        toast.error(`${plural(data.notFound!.length)} couldn't be moved (already gone).`);
      }
      onMoved(moved);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't move the photos.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Move {plural(ids.length)} to...</DialogTitle>
          <DialogDescription>Choose the job these photos belong to.</DialogDescription>
        </DialogHeader>
        {jobs ? (
          <Select items={items} value={target || null} onValueChange={(v) => v && setTarget(v)}>
            <SelectTrigger aria-label="Move to" className="w-full">
              <SelectValue placeholder="Choose a job" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(items).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="flex justify-center py-2">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !jobs || !target} onClick={handleMove}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Mode = "view" | "move";

function Viewer({
  photos,
  index,
  currentJobId,
  onIndex,
  onClose,
  onImageError,
  onRequestDelete,
  onMoved,
}: {
  photos: SignedPhoto[];
  index: number;
  currentJobId: string | null;
  onIndex: (i: number) => void;
  onClose: () => void;
  onImageError: () => void;
  onRequestDelete: () => void;
  onMoved: (id: string) => void;
}) {
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
      setMode("view");
      // It no longer belongs in this list.
      onMoved(photo.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't move the photo.");
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
              <Button variant="secondary" size="sm" onClick={onRequestDelete}>
                <Trash2 className="mr-1.5 h-4 w-4" />
                Delete
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
