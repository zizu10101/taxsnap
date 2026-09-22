"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"

// Same Base UI Dialog primitive as dialog.tsx (see that file's note - this
// codebase's shadcn style is "base-nova", wrapping @base-ui/react, not
// Radix), just anchored/animated from the bottom edge instead of centered -
// the standard mobile "sheet slides up" pattern, used for the bottom nav's
// "More" overflow.
function Sheet({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/30 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  ...props
}: DialogPrimitive.Popup.Props) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Popup
        data-slot="sheet-content"
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[80vh] flex-col gap-1 rounded-t-2xl border-t bg-sidebar p-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] text-sidebar-foreground shadow-[0_-8px_24px_-8px_rgba(0,0,0,0.4)] outline-none duration-150 data-open:animate-in data-open:slide-in-from-bottom data-closed:animate-out data-closed:slide-out-to-bottom",
          className
        )}
        {...props}
      >
        <div className="mx-auto mb-1 h-1 w-9 shrink-0 rounded-full bg-sidebar-foreground/25" />
        {children}
      </DialogPrimitive.Popup>
    </SheetPortal>
  )
}

function SheetTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="sheet-title"
      className={cn("px-2 pt-1 text-xs font-semibold text-sidebar-foreground/60 uppercase tracking-wider", className)}
      {...props}
    />
  )
}

export { Sheet, SheetTrigger, SheetPortal, SheetClose, SheetOverlay, SheetContent, SheetTitle }
