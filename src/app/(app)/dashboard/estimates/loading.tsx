import { PageSkeleton } from "@/components/dashboard/page-skeleton";

export default function Loading() {
  return (
    <PageSkeleton
      title="Estimates"
      subtitle="Quote a job, then convert it to an invoice once it's approved."
      variant="list"
      back="plain"
    />
  );
}
