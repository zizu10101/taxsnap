"use client"

import * as React from "react"
import { NavigationMenu as NavigationMenuPrimitive } from "@base-ui/react/navigation-menu"
import { ChevronDownIcon } from "lucide-react"

import { cn } from "@/lib/utils"

// Base UI's NavigationMenu, not Menu (which DropdownMenu already wraps for
// action/command menus) - this one is purpose-built for a marketing nav's
// hover-to-open link lists, matching how the header's Features/Pricing
// dropdowns behave.
function NavigationMenu({
  className,
  ...props
}: NavigationMenuPrimitive.Root.Props) {
  return (
    <NavigationMenuPrimitive.Root
      data-slot="navigation-menu"
      className={cn("relative", className)}
      {...props}
    />
  )
}

function NavigationMenuList({
  className,
  ...props
}: NavigationMenuPrimitive.List.Props) {
  return (
    <NavigationMenuPrimitive.List
      data-slot="navigation-menu-list"
      className={cn("flex items-center gap-1", className)}
      {...props}
    />
  )
}

function NavigationMenuItem({ ...props }: NavigationMenuPrimitive.Item.Props) {
  return <NavigationMenuPrimitive.Item data-slot="navigation-menu-item" {...props} />
}

function NavigationMenuTrigger({
  className,
  children,
  ...props
}: NavigationMenuPrimitive.Trigger.Props) {
  return (
    <NavigationMenuPrimitive.Trigger
      data-slot="navigation-menu-trigger"
      className={cn(
        "flex items-center gap-1 text-sm font-medium text-muted-foreground outline-none hover:text-foreground data-popup-open:text-foreground",
        className
      )}
      {...props}
    >
      {children}
      <ChevronDownIcon className="h-3.5 w-3.5 transition-transform data-popup-open:rotate-180" />
    </NavigationMenuPrimitive.Trigger>
  )
}

function NavigationMenuContent({
  className,
  ...props
}: NavigationMenuPrimitive.Content.Props) {
  return (
    <NavigationMenuPrimitive.Content
      data-slot="navigation-menu-content"
      className={cn("p-2", className)}
      {...props}
    />
  )
}

function NavigationMenuLink({
  className,
  ...props
}: NavigationMenuPrimitive.Link.Props) {
  return (
    <NavigationMenuPrimitive.Link
      data-slot="navigation-menu-link"
      className={cn(
        "flex flex-col gap-0.5 rounded-md px-2.5 py-2 text-sm outline-none hover:bg-accent",
        className
      )}
      {...props}
    />
  )
}

function NavigationMenuPortal({ ...props }: NavigationMenuPrimitive.Portal.Props) {
  return <NavigationMenuPrimitive.Portal data-slot="navigation-menu-portal" {...props} />
}

function NavigationMenuPositioner({
  className,
  sideOffset = 8,
  ...props
}: NavigationMenuPrimitive.Positioner.Props) {
  return (
    <NavigationMenuPrimitive.Positioner
      data-slot="navigation-menu-positioner"
      className={cn("z-50 outline-none", className)}
      sideOffset={sideOffset}
      {...props}
    />
  )
}

function NavigationMenuPopup({
  className,
  ...props
}: NavigationMenuPrimitive.Popup.Props) {
  return (
    <NavigationMenuPrimitive.Popup
      data-slot="navigation-menu-popup"
      className={cn(
        "w-(--popup-width) min-w-56 origin-(--transform-origin) rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
        className
      )}
      {...props}
    />
  )
}

function NavigationMenuViewport({
  className,
  ...props
}: NavigationMenuPrimitive.Viewport.Props) {
  return (
    <NavigationMenuPrimitive.Viewport
      data-slot="navigation-menu-viewport"
      className={cn("relative h-(--popup-height) w-full overflow-hidden", className)}
      {...props}
    />
  )
}

export {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuTrigger,
  NavigationMenuContent,
  NavigationMenuLink,
  NavigationMenuPortal,
  NavigationMenuPositioner,
  NavigationMenuPopup,
  NavigationMenuViewport,
}
