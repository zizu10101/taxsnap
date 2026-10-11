import { PageSkeleton } from "@/components/dashboard/page-skeleton";

export default function Loading() {
  return (
    <PageSkeleton
      title="Hours"
      subtitle="Log hours worked per employee, per job."
      variant="list"
      back="plain"
    />
  );
}
