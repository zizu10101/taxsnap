import { PageSkeleton } from "@/components/dashboard/page-skeleton";

export default function Loading() {
  return (
    <PageSkeleton
      title="Clients"
      subtitle="Every client's invoice history in one place."
      variant="list"
      back="plain"
    />
  );
}
