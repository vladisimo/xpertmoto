"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { MessageCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useSupportWidget } from "@/stores/support-widget";
import type { SupportPublicConfig } from "@/lib/support-config";
import { SupportTriage } from "./support-triage";
import { SupportStructuredForm } from "./support-structured-form";
import { SupportChatPanel } from "./support-chat-panel";
import { SupportSent } from "./support-sent";
import { trpc } from "@/lib/trpc/client";
import { useBranding } from "@/components/shared/branding-provider";

export interface SupportWidgetProps {
  config: SupportPublicConfig;
  customer: { id: string; firstName: string | null } | null;
}

/**
 * Top-level floating launcher + panel. Routes between the triage,
 * structured-form, AI-chat, and sent-confirmation surfaces via the
 * Zustand store. Hidden entirely when the feature is disabled
 * server-side (the gate short-circuits before this component renders).
 */
export function SupportWidget({ config, customer }: SupportWidgetProps) {
  const { siteName } = useBranding();
  const { isOpen, step, close, toggle, reset } = useSupportWidget();
  const pathname = usePathname();

  // Customer portal has a bottom tab bar on mobile (<lg) — lift the widget
  // above it so the launcher isn't hidden behind the nav.
  const isCustomerPortal = pathname?.startsWith("/dashboard") ?? false;

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, close]);

  const headline =
    customer?.firstName
      ? `Hi ${customer.firstName} — how can we help?`
      : "How can we help?";

  const positionClass = isCustomerPortal
    ? "bottom-[calc(4rem+env(safe-area-inset-bottom))] right-4 lg:bottom-6 lg:right-6"
    : "bottom-4 right-4 sm:bottom-6 sm:right-6";

  return (
    <div
      className={cn(
        "fixed z-[60] flex flex-col items-end gap-3",
        positionClass,
      )}
    >
      {isOpen && (
        <div
          role="dialog"
          aria-label={`${siteName} support`}
          className={cn(
            "flex h-[720px] max-h-[75dvh] w-[480px] max-w-[calc(100vw-2rem)]",
            "sm:max-h-[calc(100vh-6rem)]",
            "flex-col overflow-hidden rounded-lg border border-border bg-card",
            "shadow-2xl",
          )}
        >
          <header className="flex items-center justify-between border-b bg-primary px-4 py-3 text-primary-foreground">
            <div>
              <p className="text-xs uppercase tracking-wider opacity-80">{`${siteName} support`}</p>
              <h2 className="text-sm font-semibold">{headline}</h2>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close support"
              className="rounded-md p-1 opacity-80 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto">
            {step === "triage" && <SupportTriage config={config} hasCustomer={!!customer} />}
            {step === "form" && <SupportStructuredForm hasCustomer={!!customer} />}
            {step === "chat" && <SupportChatPanel hasCustomer={!!customer} />}
            {step === "sent" && <SupportSent />}
          </div>

          <footer className="border-t bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
            <button
              type="button"
              className="rounded-sm underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                reset();
              }}
            >
              Start a new conversation
            </button>
          </footer>
        </div>
      )}

      <Button
        type="button"
        variant="default"
        size="lg"
        onClick={toggle}
        aria-label={isOpen ? "Close support" : "Open support"}
        className="h-14 w-14 rounded-full p-0 shadow-lg"
      >
        {isOpen ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
      </Button>

      {/* Prefetch config on first render so the widget is warm. */}
      <ConfigPrefetcher />
    </div>
  );
}

function ConfigPrefetcher(): null {
  trpc.support.config.useQuery(undefined, { staleTime: 60_000 });
  return null;
}
