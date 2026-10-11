"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AddPhotosButton } from "@/components/photos/add-photos-dialog";
import { PhotoGallery } from "@/components/photos/photo-gallery";

// The Photos section of a job page: add photos (this job preselected) and a thumbnail grid.
export function JobPhotosSection({
  job,
  jobNames,
}: {
  job: { id: string; name: string };
  jobNames: string[];
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Photos</CardTitle>
        <AddPhotosButton jobNames={jobNames} fixedJob={job} />
      </CardHeader>
      <CardContent>
        <PhotoGallery jobId={job.id} empty="No photos on this job yet." />
      </CardContent>
    </Card>
  );
}
