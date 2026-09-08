import Link from "next/link";
import { Button } from "@/components/ui/button";

// Shared by every top-level landing page (/, /salons, /features) - was
// duplicated inline across the first two until this page made it three
// copies to keep the nav links in sync across, at which point centralizing
// it was worth doing. `getStartedHref` differs per page (e.g. /salons
// passes ?business=salon to default the signup flow's business type).
export function LandingHeader({ getStartedHref = "/auth" }: { getStartedHref?: string }) {
  return (
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5 sm:px-8">
      <div className="flex items-center gap-8">
        <Link
          href="/"
          className="flex items-center gap-2 font-heading text-lg font-bold tracking-tight"
        >
          <img src="/logo-mark.png" alt="" className="h-9 w-9" />
          TaxSnap
        </Link>
        <nav className="hidden sm:block">
          <Link
            href="/features"
            className="text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Features
          </Link>
        </nav>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/auth" />}>
          Sign in
        </Button>
        <Button size="sm" nativeButton={false} render={<Link href={getStartedHref} />}>
          Get Started
        </Button>
      </div>
    </header>
  );
}
