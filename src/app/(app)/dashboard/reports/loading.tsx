import { PageSkeleton } from "@/components/dashboard/page-skeleton";

export default function Loading() {
  return (
    <PageSkeleton
      title="Reports"
      subtitle="Profit & loss, job summary and expenses by category."
      variant="cards"
      back="link"
    />
  );
}
