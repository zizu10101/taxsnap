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
      <span
        className={cn(
          "text-center leading-tight",
          size === "sidebar" ? "text-[11px]" : "text-[10px]",
          active ? "font-semibold" : "font-medium",
        )}
      >
        {item.label}
      </span>
    </Button>
  );
}
