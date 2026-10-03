import Link from "next/link";
import { KeyRound } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Employee login is managed on the Employees page: the shared sign-in link
// and each employee's PIN live there, next to who is clocked in. Settings only
// points to it, so there is one home and nothing to keep in sync here.
export function EmployeeLoginSettings() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-4 w-4" />
          Employee login
        </CardTitle>
        <CardDescription>
          Employees clock in and out of jobs with one shared link and their own 4-digit PIN.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Create the sign-in link and manage employee PINs from the{" "}
          <Link
            href="/dashboard/employees"
            className="font-medium text-foreground underline hover:text-primary"
          >
            Employees page
          </Link>
          .
        </p>
      </CardContent>
    </Card>
  );
}
