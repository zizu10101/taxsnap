"use client";

import Image from "next/image";

// Shared chrome for the two onboarding steps, in the app's dark sidebar look: a
// dark page, the brand mark, a visible "Step X of Y" with a progress bar, and a
// light card holding the step. Mobile first: the card is full width on a phone.
export function OnboardingStepShell({
  stepNumber,
  totalSteps,
  title,
  description,
  children,
}: {
  stepNumber: number;
  totalSteps: number;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-1 flex-col items-center bg-sidebar px-4 py-6 text-sidebar-foreground sm:justify-center">
      <div className="w-full max-w-md space-y-5">
        <div className="flex items-center justify-between">
          <Image src="/logo-mark.png" alt="TaxSnap" width={36} height={36} className="h-9 w-9" priority />
          <p className="text-sm font-medium text-sidebar-foreground/80">
            Step {stepNumber} of {totalSteps}
          </p>
        </div>
        <div
          className="flex gap-2"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={totalSteps}
          aria-valuenow={stepNumber}
          aria-label={`Step ${stepNumber} of ${totalSteps}`}
        >
          {Array.from({ length: totalSteps }, (_, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full ${i < stepNumber ? "bg-primary" : "bg-sidebar-foreground/20"}`}
            />
          ))}
        </div>
        <div className="rounded-2xl bg-card p-5 text-card-foreground shadow-lg sm:p-6">
          <div className="mb-5">
            <h1 className="text-2xl font-bold">{title}</h1>
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}
