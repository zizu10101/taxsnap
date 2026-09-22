// The only control that can move a session between Manager and Staff mode
// (unchanged from the old DashboardHeader - see app-lock-context.tsx).
// Clicking the inactive side calls onRequestSwitch (relock()), which drops
// to the lock screen; re-entering the matching PIN there is what actually
// grants the new mode. Clicking the already-active side is a no-op.
// Shared by DashboardTopBar (desktop) and the mobile "More" sheet, which
// both need to expose it wherever they render account actions.
export function ModeToggle({
  isStaffMode,
  onRequestSwitch,
  // The mobile "More" sheet renders this on the always-dark sidebar
  // surface regardless of the page's light/dark theme (see globals.css's
  // --sidebar tokens) - the default light-mode border/muted colors would
  // be low-contrast there, so the sheet passes true to use sidebar tokens
  // instead.
  onDark = false,
}: {
  isStaffMode: boolean;
  onRequestSwitch: () => void;
  onDark?: boolean;
}) {
  const idleText = onDark ? "text-sidebar-foreground/60" : "text-muted-foreground";
  return (
    <div
      className={`flex items-center rounded-full border p-0.5 text-xs font-medium ${
        onDark ? "border-sidebar-border bg-sidebar-accent/50" : "border-border bg-muted/40"
      }`}
    >
      <button
        type="button"
        onClick={() => isStaffMode && onRequestSwitch()}
        aria-pressed={!isStaffMode}
        className={`rounded-full px-2.5 py-1 transition-colors ${!isStaffMode ? "bg-primary text-primary-foreground" : idleText}`}
      >
        Manager
      </button>
      <button
        type="button"
        onClick={() => !isStaffMode && onRequestSwitch()}
        aria-pressed={isStaffMode}
        className={`rounded-full px-2.5 py-1 transition-colors ${isStaffMode ? "bg-primary text-primary-foreground" : idleText}`}
      >
        Staff
      </button>
    </div>
  );
}
