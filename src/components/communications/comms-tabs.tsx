"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Inbox,
  MessageSquare,
  Send,
  ShieldCheck,
  Target,
  Zap,
} from "lucide-react";

import { cn } from "@/lib/utils";

type Tab = { href: string; label: string; icon: typeof Inbox };

const TABS: Tab[] = [
  { href: "/staff/communications", label: "Log", icon: Inbox },
  { href: "/staff/communications/compose", label: "Compose", icon: Send },
  { href: "/staff/communications/campaigns", label: "Campaigns", icon: MessageSquare },
  { href: "/staff/communications/segments", label: "Segments", icon: Target },
  { href: "/staff/communications/preferences", label: "Preferences", icon: ShieldCheck },
  { href: "/staff/communications/automations", label: "Automations", icon: Zap },
];

export function CommsTabs() {
  const pathname = usePathname() ?? "";
  return (
    <nav
      aria-label="Communications sections"
      className="inline-flex h-10 w-full items-center justify-start gap-1 overflow-x-auto border-b bg-transparent p-0"
    >
      {TABS.map((t) => {
        const active = t.href === "/staff/communications"
          ? pathname === t.href
          : pathname.startsWith(t.href);
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm font-medium ring-offset-background transition-all",
              "border-b-2 border-transparent text-muted-foreground",
              "hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              active && "border-primary text-foreground font-semibold",
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            <span>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
