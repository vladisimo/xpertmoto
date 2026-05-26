"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  FileText,
  Layers,
  LayoutDashboard,
  Lock,
  Receipt,
  Repeat,
  Scale,
  Tags,
  Webhook,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = { href: string; label: string; icon: typeof LayoutDashboard };

const TABS: Tab[] = [
  { href: "/admin/finance", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/finance/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/admin/finance/invoices", label: "Invoices", icon: FileText },
  { href: "/admin/finance/bonds", label: "Bonds", icon: Lock },
  { href: "/admin/finance/gst", label: "GST / BAS", icon: Receipt },
  { href: "/admin/finance/reconciliation", label: "Reconciliation", icon: Scale },
  { href: "/admin/finance/recurring", label: "Recurring", icon: Repeat },
  { href: "/admin/pricing", label: "Pricing", icon: Tags },
  { href: "/admin/finance/categories", label: "Categories", icon: Layers },
  { href: "/admin/webhooks", label: "Webhook health", icon: Webhook },
];

export function FinanceTabsBar() {
  const pathname = usePathname() ?? "";
  return (
    <nav
      aria-label="Finance sections"
      className="-mx-3 inline-flex h-10 w-full items-center justify-start gap-1 overflow-x-auto border-b bg-transparent px-3 sm:mx-0 sm:px-0"
    >
      {TABS.map((t) => {
        const active =
          t.href === "/admin/finance"
            ? pathname === t.href
            : pathname === t.href || pathname.startsWith(t.href + "/");
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
