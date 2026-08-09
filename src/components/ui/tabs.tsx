"use client"

import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

const Tabs = TabsPrimitive.Root

/**
 * The list/trigger class strings, exported so a bar that only *looks* like a
 * tab strip can render identically without borrowing the ARIA tab roles.
 *
 * A `TabsTrigger` announces `role="tab"` + `aria-controls`, which is a lie
 * unless a matching `TabsContent` tabpanel exists. Bars that instead navigate,
 * set a query param, or toggle a sibling that is not a `TabsContent` must
 * render plain buttons/links with `aria-pressed` / `aria-current` and reuse
 * these strings — set `data-state="active"` on the selected one so the
 * `data-[state=active]:` variants below still apply.
 */
const tabsListClassName =
  "inline-flex h-10 items-center justify-start gap-1 border-b bg-transparent p-0"

const tabsTriggerClassName = [
  "inline-flex items-center justify-center whitespace-nowrap px-3 py-2 text-sm font-medium ring-offset-background transition-all",
  "border-b-2 border-transparent text-muted-foreground",
  "hover:text-foreground",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  "disabled:pointer-events-none disabled:opacity-50",
  "data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:font-semibold",
].join(" ")

const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(tabsListClassName, className)}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(tabsTriggerClassName, className)}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-4 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  tabsListClassName,
  tabsTriggerClassName,
}
