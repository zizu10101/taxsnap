"use client";

import { Button } from "@/components/ui/button";
import { EmployeeList } from "@/components/employees/employee-list";
import { OnboardingStepShell } from "../onboarding-step-shell";
import type { Employee, SubscriptionStatus } from "@/lib/database.types";

// Not Pro-gated - employees are capped, not locked, at every tier (1/5/
// unlimited active - see src/lib/plan-limits.ts); EmployeeList's own
// usage bar and create-flow upgrade toast handle the cap here same as on
// the real Employees tab.
export function StaffStep({
  subscriptionStatus,
  initialEmployees,
  onNext,
}: {
  subscriptionStatus: SubscriptionStatus;
  initialEmployees: Employee[];
  onNext: () => void;
}) {
  return (
    <OnboardingStepShell
      stepNumber={3}
      totalSteps={3}
      title="Add your staff"
      description="Just names for now - hourly rates and job costing can be set up anytime from Employees."
      onSkip={onNext}
    >
      <EmployeeList
        initialEmployees={initialEmployees}
        subscriptionStatus={subscriptionStatus}
        showNav={false}
      />
      <Button className="w-full" onClick={onNext}>
        Continue
      </Button>
    </OnboardingStepShell>
  );
}
