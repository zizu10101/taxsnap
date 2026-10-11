import { PageSkeleton } from "@/components/dashboard/page-skeleton";

export default function Loading() {
  return (
    <PageSkeleton
      title="Jobs"
      subtitle="True cost per job: tagged expenses plus logged labor."
      variant="list"
      back="plain"
    />
  );
}
