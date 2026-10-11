import { PageSkeleton } from "@/components/dashboard/page-skeleton";

export default function Loading() {
  return (
    <PageSkeleton
      title="Expenses"
      subtitle="Every scanned receipt, filtered by date range."
      variant="list"
      back="link"
    />
  );
}
