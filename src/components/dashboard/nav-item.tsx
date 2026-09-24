import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/components/dashboard/nav-config";

// Shared icon-above-label nav pill for both the desktop sidebar (vertical
// column) and the mobile bottom nav (horizontal row) - same active/idle/
// hover color logic either way (sidebar tokens, not the page's light-mode
// card tokens - see globals.css), just different sizing.
export function NavItemButton({
  item,
  active,
  size = "sidebar",
}: {
  item: NavItem;
  active: boolean;
  size?: "sidebar" | "bottomnav";
}) {
  const Icon = item.icon;
  return (
    <Button
      variant="ghost"
      nativeButton={false}
      render={<Link href={item.href} />}
      className={cn(
        "flex h-auto w-full flex-col items-center justify-center gap-1 rounded-lg text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground",
        size === "sidebar" ? "px-1 py-2.5" : "px-0.5 py-2",
        active && "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary hover:text-sidebar-primary-foreground",
      )}
    >
      <Icon className={size === "sidebar" ? "h-5 w-5" : "h-5 w-5"} strokeWidth={1.6} />
      {/* whitespace-normal overrides whitespace-nowrap, which the Button's
          own base classes set and which this span inherits by default
          (white-space is an inherited CSS property) - without it, a
          two-word label like "Progress Billing" (the only multi-word one
          in the nav) is barred from wrapping at all regardless of width,
          and renders on one unbroken line that overflows past the
          button's own w-full background, so the active pill's highlight
          doesn't reach the overflowing text. min-w-0 additionally
          overrides the flex item default of min-width: auto, which would
          otherwise still refuse to shrink the span below its unwrapped
          preferred width even once wrapping is allowed. */}
      <span
        className={cn(
          "w-full min-w-0 text-center leading-tight whitespace-normal",
          size === "sidebar" ? "text-[11px]" : "text-[10px]",
          active ? "font-semibold" : "font-medium",
        )}
      >
        {item.label}
      </span>
    </Button>
  );
}
