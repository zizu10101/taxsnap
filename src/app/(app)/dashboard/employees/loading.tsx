import { PageSkeleton } from "@/components/dashboard/page-skeleton";

export default function Loading() {
  return (
    <PageSkeleton
      title="Employees"
      subtitle="Manage your team and their default hourly rates."
      variant="list"
      back="plain"
    />
  );
}
