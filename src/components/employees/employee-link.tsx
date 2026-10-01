import Link from "next/link";
import { cn } from "@/lib/utils";

// How every page other than Employees refers to an employee: just their name,
// linking to the Employees page. Employees has exactly one real home in the
// nav (the Employees tab); Jobs, Hours and the rest point there instead of
// re-showing employee details of their own.
export function EmployeeLink({ name, className }: { name: string; className?: string }) {
  return (
    <Link
      href="/dashboard/employees"
      title="Open Employees"
      className={cn("hover:text-primary hover:underline", className)}
    >
      {name}
    </Link>
  );
}
