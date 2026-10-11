import { PageSkeleton } from "@/components/dashboard/page-skeleton";

export default function Loading() {
  return (
    <PageSkeleton
      title="Photos"
      subtitle="Unsorted: snapped without a job. Open a photo to move it to one."
      variant="grid"
      back="plain"
    />
  );
}
