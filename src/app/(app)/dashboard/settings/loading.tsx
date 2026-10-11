import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-2xl" role="status" aria-label="Loading Settings">
      <div className="mb-4 h-5" />
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Manage app-wide preferences.</p>
      </div>
      <div className="space-y-6">
        <Skeleton className="h-36 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    </div>
  );
}
