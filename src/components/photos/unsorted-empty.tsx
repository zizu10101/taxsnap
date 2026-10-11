"use client";

import { Camera } from "lucide-react";
import { AddPhotosButtons } from "@/components/photos/add-photos-dialog";

// The /dashboard/photos empty state: nothing unsorted yet, with the two ways to add photos right there.
export function UnsortedEmpty({ jobNames }: { jobNames: string[] }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Camera className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="font-medium">No unsorted photos yet</p>
      <p className="max-w-xs text-sm text-muted-foreground">
        Snap a photo now and file it under a job later. Photos you add without a job land here.
      </p>
      <AddPhotosButtons jobNames={jobNames} />
    </div>
  );
}
