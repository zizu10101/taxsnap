"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Menu, Moon, Sun, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuPopup,
  NavigationMenuPortal,
  NavigationMenuPositioner,
  NavigationMenuTrigger,
  NavigationMenuViewport,
} from "@/components/ui/navigation-menu";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useTheme } from "@/components/theme-sync";
import { FEATURE_PAGES } from "@/lib/feature-pages";
import { FREE_PLAN, PRICING_PLANS } from "@/lib/pricing-plans";

// Collapses Settings' full Light/Dark/System picker (see ThemeSettings)
// into a simple binary override for a nav-level control - the standard
// pattern for a header toggle. Reuses useTheme() as-is: same localStorage
// key and DOM-class mechanism the root layout already applies on every
// route (including these marketing pages), so the choice already carries
// into the app after login with zero extra wiring - see CLAUDE.md's
// Stack quirks note for why the profile-sync PATCH this hook also fires
// is safe to call while signed out (it 401s, and the hook already
// swallows that failure).
function ThemeToggle() {
  const { resolvedTheme, setPreference } = useTheme();
  const isDark = resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setPreference(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}

// Shared by the desktop NavigationMenu content and the mobile accordion -
// same five links either way.
function FeatureLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      {FEATURE_PAGES.map((feature) => (
        <NavigationMenuLink
          key={feature.href}
          render={<Link href={feature.href} onClick={onNavigate} />}
        >
          <span className="flex items-center gap-2 font-medium text-foreground">
            <feature.icon className="h-4 w-4 text-primary" />
            {feature.title}
          </span>
        </NavigationMenuLink>
      ))}
    </>
  );
}

// Shared by the desktop NavigationMenu content and the mobile flat list -
// tier names/order always come from PRICING_PLANS/FREE_PLAN, never
// hardcoded, so a future rename (like Basic -> Plus) can't leave this
// dropdown stale. Card-specific anchor ids (#plan-free, #plan-basic,
// #plan-pro) are added on pricing-section.tsx's own cards.
function PricingLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <NavigationMenuLink render={<Link href="/#plan-free" onClick={onNavigate} />}>
        <span className="font-medium text-foreground">{FREE_PLAN.name}</span>
        <span className="text-xs text-muted-foreground">{FREE_PLAN.price}</span>
      </NavigationMenuLink>
      {PRICING_PLANS.map((plan) => (
        <NavigationMenuLink
          key={plan.tier}
          render={<Link href={`/#plan-${plan.tier}`} onClick={onNavigate} />}
        >
          <span className="font-medium text-foreground">{plan.name}</span>
          <span className="text-xs text-muted-foreground">
            ${plan.monthlyPrice} CAD/mo
          </span>
        </NavigationMenuLink>
      ))}
      <NavigationMenuLink render={<Link href="/salons#pricing" onClick={onNavigate} />}>
        <span className="font-medium text-foreground">Salon pricing</span>
        <span className="text-xs text-muted-foreground">Commission &amp; payouts pricing</span>
      </NavigationMenuLink>
    </>
  );
}

// Shared by every top-level landing page (/, /salons, /features and its
// sub-pages via FeatureDetail) - `getStartedHref` differs per page (e.g.
// /salons passes ?business=salon to default the signup flow's business
// type).
export function LandingHeader({ getStartedHref = "/auth" }: { getStartedHref?: string }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileFeaturesOpen, setMobileFeaturesOpen] = useState<string[]>([]);
  const closeMobile = () => setMobileOpen(false);
  const onSalons = usePathname() === "/salons";

  return (
    <header className="relative border-b border-border">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4 sm:px-8">
        <div className="flex items-center gap-8">
          <Link
            href="/"
            className="flex items-center gap-2 font-heading text-lg font-bold tracking-tight"
          >
            <img src="/logo-mark.png" alt="" className="h-9 w-9" />
            TaxSnap
          </Link>

          {/* Desktop nav - hidden below md, replaced by the mobile panel. */}
          <NavigationMenu className="hidden md:block">
            <NavigationMenuList>
              <NavigationMenuItem>
                <NavigationMenuTrigger>Features</NavigationMenuTrigger>
                <NavigationMenuContent>
                  <div className="grid w-64 gap-1">
                    <FeatureLinks />
                  </div>
                </NavigationMenuContent>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuTrigger>Pricing</NavigationMenuTrigger>
                <NavigationMenuContent>
                  <div className="grid w-64 gap-1">
                    <PricingLinks />
                  </div>
                </NavigationMenuContent>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuLink
                  render={<Link href="/salons" />}
                  aria-current={onSalons ? "page" : undefined}
                  className={`flex-row px-0 py-0 text-sm font-medium hover:bg-transparent hover:text-foreground ${
                    onSalons ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  For Salons
                </NavigationMenuLink>
              </NavigationMenuItem>
            </NavigationMenuList>
            <NavigationMenuPortal>
              <NavigationMenuPositioner>
                <NavigationMenuPopup>
                  <NavigationMenuViewport />
                </NavigationMenuPopup>
              </NavigationMenuPositioner>
            </NavigationMenuPortal>
          </NavigationMenu>
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <ThemeToggle />
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/auth" />}>
            Sign in
          </Button>
          <Button size="sm" nativeButton={false} render={<Link href={getStartedHref} />}>
            Get Started
          </Button>
        </div>

        {/* Mobile: theme toggle stays visible next to the hamburger so it
            doesn't need its own row inside the panel. */}
        <div className="flex items-center gap-1 md:hidden">
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {mobileOpen && (
        <div className="border-t border-border bg-card px-4 py-4 sm:px-8 md:hidden">
          <Accordion
            value={mobileFeaturesOpen}
            onValueChange={(v) => setMobileFeaturesOpen(v as string[])}
          >
            <AccordionItem value="features">
              <AccordionTrigger>Features</AccordionTrigger>
              <AccordionContent>
                <div className="flex flex-col gap-1">
                  <FeatureLinks onNavigate={closeMobile} />
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <div className="border-b border-border py-3">
            <p className="flex items-center gap-1 text-sm font-medium">
              Pricing
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </p>
            <div className="mt-2 flex flex-col gap-1">
              <PricingLinks onNavigate={closeMobile} />
            </div>
          </div>

          <div className="border-b border-border py-3">
            <Link
              href="/salons"
              onClick={closeMobile}
              aria-current={onSalons ? "page" : undefined}
              className={`block text-sm font-medium ${onSalons ? "text-foreground" : ""}`}
            >
              For Salons
            </Link>
          </div>

          <div className="flex flex-col gap-2 pt-4">
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href="/auth" onClick={closeMobile} />}
            >
              Sign in
            </Button>
            <Button
              nativeButton={false}
              render={<Link href={getStartedHref} onClick={closeMobile} />}
            >
              Get Started
            </Button>
          </div>
        </div>
      )}
    </header>
  );
}
