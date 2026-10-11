import { PageSkeleton } from "@/components/dashboard/page-skeleton";

export default function Loading() {
  return (
    <PageSkeleton
      title="Register"
      subtitle="Add services and products to a sale, then check out."
      variant="grid"
      back="link"
      narrow
    />
  );
}
