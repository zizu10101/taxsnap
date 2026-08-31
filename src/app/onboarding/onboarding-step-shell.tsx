"use client";

// Shared chrome for every onboarding step: progress label, title, the
// step's own content, and a uniform "Skip for now" - present on every step
// per spec, even where a step also renders its own primary action (that
// action is just part of `children`, placed above this footer link).
export function OnboardingStepShell({
  stepNumber,
  totalSteps = 5,
  title,
  description,
  children,
  onSkip,
}: {
  stepNumber: number;
  totalSteps?: number;
  title: string;
  description?: string;
  children: React.ReactNode;
  onSkip: () => void;
}) {
  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm space-y-4">
        <p className="text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Step {stepNumber} of {totalSteps}
        </p>
        <div className="text-center">
          <h1 className="text-xl font-bold">{title}</h1>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {children}
        <button
          type="button"
          onClick={onSkip}
          className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
        >
          Skip for now
        </button>
      </div>
    </main>
  );
}
