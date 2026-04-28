"use client";

import { AlertTriangle, Bike, CreditCard, MessageCircleQuestion } from "lucide-react";
import type { ComponentType } from "react";
import { cn } from "@/lib/utils";
import { useSupportWidget, type WidgetCategory } from "@/stores/support-widget";
import { trpc } from "@/lib/trpc/client";
import type { SupportPublicConfig } from "@/lib/support-config";

type TriageOption = {
  category: WidgetCategory;
  label: string;
  blurb: string;
  icon: ComponentType<{ className?: string }>;
  tone: "danger" | "warning" | "info" | "neutral";
  goTo: "form" | "chat";
};

const OPTIONS: TriageOption[] = [
  {
    category: "BREAKDOWN",
    label: "Breakdown or mechanical issue",
    blurb: "Punctured tyre, scooter won't start, warning light. We'll page the depot.",
    icon: Bike,
    tone: "danger",
    goTo: "form",
  },
  {
    category: "ABANDONED_VEHICLE",
    label: "Scooter left somewhere",
    blurb: "Someone parked our scooter unexpectedly or it's been abandoned.",
    icon: AlertTriangle,
    tone: "warning",
    goTo: "form",
  },
  {
    category: "PAYMENT",
    label: "Payment, invoice, or bond question",
    blurb: "Refund query, disputed charge, bond release. We route to our finance team.",
    icon: CreditCard,
    tone: "info",
    goTo: "form",
  },
  {
    category: "GENERAL",
    label: "Ask a question",
    blurb: "Pricing, availability, how-to, opening hours — anything else.",
    icon: MessageCircleQuestion,
    tone: "neutral",
    goTo: "chat",
  },
];

const TONE_CLASSES: Record<TriageOption["tone"], string> = {
  danger: "border-destructive/40 text-destructive",
  warning: "border-amber-400/60 text-amber-700 dark:text-amber-300",
  info: "border-accent/40 text-accent-foreground",
  neutral: "border-border text-foreground",
};

export function SupportTriage({
  config,
  hasCustomer,
}: {
  config: SupportPublicConfig;
  hasCustomer: boolean;
}) {
  const { setStep, setCategory, setConversationId, conversationId } = useSupportWidget();
  const start = trpc.support.startConversation.useMutation();

  async function pick(option: TriageOption) {
    setCategory(option.category);

    // Chat requires AI; if disabled, force to form.
    const nextStep =
      option.goTo === "chat" && !config.aiEnabled ? "form" : option.goTo;

    // Lazy-create a conversation the first time we need one.
    let id = conversationId;
    if (!id) {
      const res = await start.mutateAsync({});
      id = res.conversationId;
      setConversationId(id);
    }
    setStep(nextStep);
  }

  return (
    <div className="space-y-3 p-4">
      <p className="text-sm text-muted-foreground">
        Tap the closest match and we&apos;ll take it from there.
      </p>
      <ul className="space-y-2">
        {OPTIONS.map((opt) => {
          const Icon = opt.icon;
          return (
            <li key={opt.category}>
              <button
                type="button"
                onClick={() => pick(opt)}
                disabled={start.isPending}
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition",
                  "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  TONE_CLASSES[opt.tone],
                )}
              >
                <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">{opt.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{opt.blurb}</p>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      {!hasCustomer && (
        <p className="text-[11px] text-muted-foreground">
          We&apos;ll ask for your name and contact details on the next screen so we can get back to you.
        </p>
      )}
    </div>
  );
}
