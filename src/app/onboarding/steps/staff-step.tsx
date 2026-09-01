"use client";

import { Button } from "@/components/ui/button";
import { EmployeeList } from "@/components/employees/employee-list";
import { OnboardingStepShell } from "../onboarding-step-shell";
import { ProLockCard } from "../pro-lock-card";
import type { Employee } from "@/lib/database.types";

export function StaffStep({
  isPro,
  initialEmployees,
  onNext,
}: {
  isPro: boolean;
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
      {isPro ? (
        <>
          <EmployeeList initialEmployees={initialEmployees} showNav={false} />
          <Button className="w-full" onClick={onNext}>
            Continue
          </Button>
        </>
      ) : (
        <ProLockCard />
      )}
    </OnboardingStepShell>
  );
}
