import { PageSkeleton } from "@/components/dashboard/page-skeleton";

export default function Loading() {
  return (
    <PageSkeleton
      title="Invoices"
      subtitle="Bill your clients directly from TaxSnap."
      variant="list"
      back="plain"
    />
  );
}
