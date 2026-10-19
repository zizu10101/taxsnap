"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { preparePhoto } from "@/lib/photo-compress";
import { MAX_CAPTION_LENGTH, MAX_PHOTOS_PER_BATCH } from "@/lib/photo-config";
import { showUpgradePrompt } from "@/lib/upgrade-prompt";

// "Add photos": capture first, file later. Take photo (phone camera) or Choose from gallery (also the
// plain "upload" on a desktop), then pick a job, type a new job name, or leave them Unsorted. Each photo
// is shrunk and cleaned on the device (lib/photo-compress.ts) and uploaded one at a time to
// /api/job-photos; the original file is never sent.

export const PHOTOS_CHANGED_EVENT = "job-photos-changed";

const UNSORTED = "__unsorted__";
const NEW_JOB = "__new_job__";

interface Picked {
  key: string;
  file: File;
  previewUrl: string;
  caption: string;
}

// Turns what the file input gave us into list items (image files only, at most MAX_PHOTOS_PER_BATCH
// including the `already` picked). Called from event handlers: it creates preview URLs.
function pickFiles(list: FileList | null, already: number): Picked[] {
  if (!list || list.length === 0) return [];
  const images = Array.from(list).filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
  if (images.length < list.length) toast.error("Only image files can be added.");
  const room = MAX_PHOTOS_PER_BATCH - already;
  if (images.length > room) toast.error(`Add up to ${MAX_PHOTOS_PER_BATCH} photos at a time.`);
  return images.slice(0, Math.max(0, room)).map((file) => ({
    key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
    file,
    previewUrl: URL.createObjectURL(file),
    caption: "",
  }));
}

// Two buttons that go straight to the camera / gallery picker and then open the form with the chosen
// photos already in it. Used where there is no photo yet to hang a single "Add photos" button on (the
// empty Unsorted page).
export function AddPhotosButtons({
  jobNames,
  fixedJob,
}: {
  jobNames: string[];
  fixedJob?: { id: string; name: string };
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [initial, setInitial] = useState<Picked[] | null>(null);

  function onChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = pickFiles(e.target.files, 0);
    e.target.value = "";
    if (picked.length > 0) setInitial(picked);
  }

  return (
    <>
      <div className="flex flex-wrap justify-center gap-2">
        <Button type="button" onClick={() => cameraRef.current?.click()}>
          <Camera className="mr-1.5 h-4 w-4" />
          Take photo
        </Button>
        <Button type="button" variant="outline" onClick={() => galleryRef.current?.click()}>
          <ImagePlus className="mr-1.5 h-4 w-4" />
          Choose from gallery
        </Button>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-label="Take photo"
          onChange={onChosen}
        />
        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose photos from gallery"
          onChange={onChosen}
        />
      </div>
      {initial && (
        <AddPhotosDialog
          jobNames={jobNames}
          fixedJob={fixedJob}
          initialPicked={initial}
          onClose={() => setInitial(null)}
        />
      )}
    </>
  );
}

export function AddPhotosButton({
  jobNames,
  fixedJob,
  label = "Add photos",
  variant = "outline",
  className,
}: {
  // Names of the user's existing jobs, for the picker.
  jobNames: string[];
  // On a job page: the job these photos belong to by default.
  fixedJob?: { id: string; name: string };
  label?: string;
  variant?: "outline" | "default";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} className={className} onClick={() => setOpen(true)}>
        <Camera className="mr-1.5 h-4 w-4" />
        {label}
      </Button>
      {/* Mounted only while open, so every visit starts from a clean form. */}
      {open && (
        <AddPhotosDialog jobNames={jobNames} fixedJob={fixedJob} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function AddPhotosDialog({
  jobNames,
  fixedJob,
  initialPicked,
  onClose,
}: {
  jobNames: string[];
  fixedJob?: { id: string; name: string };
  // Photos already chosen before the form opened (AddPhotosButtons).
  initialPicked?: Picked[];
  onClose: () => void;
}) {
  const router = useRouter();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked[]>(initialPicked ?? []);
  const [jobMode, setJobMode] = useState<string>(fixedJob ? fixedJob.name : UNSORTED);
  const [newJobName, setNewJobName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Revoke every preview URL when the dialog goes away.
  const pickedRef = useRef(picked);
  useEffect(() => {
    pickedRef.current = picked;
  }, [picked]);
  useEffect(() => {
    return () => pickedRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl));
  }, []);

  const jobItems = useMemo(() => {
    const map: Record<string, string> = { [UNSORTED]: "Unsorted (file it later)", [NEW_JOB]: "+ Add new job" };
    if (fixedJob) map[fixedJob.name] = fixedJob.name;
    for (const name of jobNames) map[name] = name;
    return map;
  }, [jobNames, fixedJob]);

  function addFiles(list: FileList | null) {
    const next = pickFiles(list, picked.length);
    if (next.length === 0) return;
    setPicked((prev) => [...prev, ...next]);
    setError(null);
  }

  function removePicked(key: string) {
    setPicked((prev) => {
      const gone = prev.find((p) => p.key === key);
      if (gone) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((p) => p.key !== key);
    });
  }

  function setCaption(key: string, caption: string) {
    setPicked((prev) => prev.map((p) => (p.key === key ? { ...p, caption } : p)));
  }

  // The job id to file under: "" = Unsorted. A typed/picked name goes through POST /api/jobs, which finds
  // an existing job by that name or creates a lightweight one (and enforces the job cap).
  async function resolveJobId(): Promise<string | null> {
    if (jobMode === UNSORTED) return "";
    const name = (jobMode === NEW_JOB ? newJobName : jobMode).trim();
    if (!name) {
      setError("Type a name for the new job, or choose Unsorted.");
      return null;
    }
    if (fixedJob && name === fixedJob.name) return fixedJob.id;
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.job?.id) {
      setError(data.error || "Couldn't create that job.");
      return null;
    }
    return data.job.id as string;
  }

  async function handleUpload() {
    if (picked.length === 0 || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const jobId = await resolveJobId();
      if (jobId === null) return;

      const total = picked.length;
      let done = 0;
      const failed: Picked[] = [];
      let stopped = false;
      setProgress({ done, total });

      // One at a time: keeps each request small, and the server's cap count honest.
      for (const item of picked) {
        if (stopped) {
          failed.push(item);
          continue;
        }
        try {
          const { photo, thumb, takenAt } = await preparePhoto(item.file);
          const form = new FormData();
          form.set("photo", photo, "photo.jpg");
          form.set("thumb", thumb, "thumb.jpg");
          form.set("job_id", jobId);
          form.set("taken_at", takenAt);
          if (item.caption.trim()) form.set("caption", item.caption.trim());
          const res = await fetch("/api/job-photos", { method: "POST", body: form });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            if (data.code === "FREE_LIMIT_REACHED") {
              stopped = true;
              showUpgradePrompt(data.error ?? "You've reached your photo limit.", router);
              setError(data.error ?? "You've reached your photo limit.");
            } else {
              setError(data.error ?? "A photo couldn't be uploaded.");
            }
            failed.push(item);
          } else {
            done += 1;
            URL.revokeObjectURL(item.previewUrl);
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : "A photo couldn't be uploaded.");
          failed.push(item);
        }
        setProgress({ done, total });
      }

      if (done > 0) {
        window.dispatchEvent(new Event(PHOTOS_CHANGED_EVENT));
        router.refresh();
      }
      // Saved as Unsorted: say where they went, with a way there.
      const unsortedAction =
        jobId === ""
          ? { action: { label: "View unsorted photos", onClick: () => router.push("/dashboard/photos") } }
          : undefined;
      if (failed.length === 0) {
        toast.success(
          done === 1 ? "Photo added" : `${done} photos added`,
          unsortedAction ? { ...unsortedAction, description: "Saved as Unsorted - file them under a job later." } : undefined,
        );
        // Previews were revoked above as each one succeeded; nothing left to show.
        pickedRef.current = [];
        onClose();
      } else {
        // Keep only what didn't go up, so a retry doesn't duplicate the others.
        setPicked(failed);
        if (done > 0) toast.success(`${done} added. ${failed.length} didn't upload.`, unsortedAction);
      }
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !uploading && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add photos</DialogTitle>
          <DialogDescription>
            Snap now, file later. Photos are shrunk on your phone before they upload.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" disabled={uploading} onClick={() => cameraRef.current?.click()}>
            <Camera className="mr-1.5 h-4 w-4" />
            Take photo
          </Button>
          <Button type="button" variant="outline" disabled={uploading} onClick={() => galleryRef.current?.click()}>
            <ImagePlus className="mr-1.5 h-4 w-4" />
            Choose from gallery
          </Button>
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-label="Take photo"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={galleryRef}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-label="Choose photos from gallery"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {picked.length > 0 && (
          <>
            <ul className="space-y-2">
              {picked.map((p) => (
                <li key={p.key} className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a local blob: preview */}
                  <img src={p.previewUrl} alt="" className="h-14 w-14 shrink-0 rounded-md object-cover" />
                  <Input
                    value={p.caption}
                    maxLength={MAX_CAPTION_LENGTH}
                    placeholder="Caption (optional)"
                    aria-label="Caption"
                    disabled={uploading}
                    onChange={(e) => setCaption(p.key, e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove photo"
                    disabled={uploading}
                    onClick={() => removePicked(p.key)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>

            <div className="space-y-2">
              <Label htmlFor="photo_job">File under</Label>
              <Select
                items={jobItems}
                value={jobMode}
                onValueChange={(v) => v && setJobMode(v)}
                disabled={uploading}
              >
                <SelectTrigger id="photo_job" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNSORTED}>Unsorted (file it later)</SelectItem>
                  <SelectItem value={NEW_JOB}>+ Add new job</SelectItem>
                  {Object.keys(jobItems)
                    .filter((k) => k !== UNSORTED && k !== NEW_JOB)
                    .map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {jobMode === NEW_JOB && (
                <Input
                  placeholder="e.g. 123 Main St"
                  value={newJobName}
                  disabled={uploading}
                  onChange={(e) => setNewJobName(e.target.value)}
                />
              )}
            </div>
          </>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={uploading} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={picked.length === 0 || uploading} onClick={handleUpload}>
            {uploading ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                {progress ? `Uploading ${Math.min(progress.done + 1, progress.total)} of ${progress.total}` : "Uploading"}
              </>
            ) : picked.length === 0 ? (
              "Add photos"
            ) : (
              `Upload ${picked.length} photo${picked.length === 1 ? "" : "s"}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
