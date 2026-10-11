import { PageSkeleton } from "@/components/dashboard/page-skeleton";

// Home, and the fallback for any /dashboard/** page without its own
// loading.tsx (Overview, Progress Billing, Saved items).
export default function Loading() {
  return <PageSkeleton title="Dashboard" subtitle="Loading your receipts..." variant="cards" back="plain" />;
}
