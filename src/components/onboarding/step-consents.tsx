"use client";

import * as React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OnboardingConsentsForm } from "@/stores/onboarding-flow";

type DocPanel = {
  key: "TERMS" | "PRIVACY" | "CANCELLATION" | "MARKETING";
  title: string;
  version: string;
  body: string;
};

export interface StepConsentsProps {
  docs: readonly DocPanel[];
  values: OnboardingConsentsForm;
  onChange: (patch: Partial<OnboardingConsentsForm>) => void;
}

/**
 * Step 4 — read & accept the four consent documents. Each panel is
 * collapsible and has its own checkbox; the marketing panel adds two
 * sub-checkboxes (email / SMS) that flow through to the wizard's
 * marketing opt-in flags.
 */
export function StepConsents({ docs, values, onChange }: StepConsentsProps) {
  return (
    <div className="space-y-4">
      <p className="body-text">
        Please read each document below and tick the box at the bottom to
        confirm you accept it. You'll sign your name once on the next
        screen, and we'll attach that signature to all four documents.
      </p>
      {docs.map((doc) => (
        <ConsentPanel
          key={doc.key}
          doc={doc}
          accepted={
            doc.key === "TERMS"
              ? values.acceptedTerms
              : doc.key === "PRIVACY"
                ? values.acceptedPrivacy
                : doc.key === "CANCELLATION"
                  ? values.acceptedCancellation
                  : values.acceptedMarketing
          }
          onAcceptedChange={(next) =>
            onChange(
              doc.key === "TERMS"
                ? { acceptedTerms: next }
                : doc.key === "PRIVACY"
                  ? { acceptedPrivacy: next }
                  : doc.key === "CANCELLATION"
                    ? { acceptedCancellation: next }
                    : { acceptedMarketing: next },
            )
          }
          marketingEmailOptIn={doc.key === "MARKETING" ? values.marketingEmailOptIn : undefined}
          marketingSmsOptIn={doc.key === "MARKETING" ? values.marketingSmsOptIn : undefined}
          onMarketingChange={
            doc.key === "MARKETING"
              ? (patch) => onChange(patch)
              : undefined
          }
        />
      ))}
    </div>
  );
}

function ConsentPanel({
  doc,
  accepted,
  onAcceptedChange,
  marketingEmailOptIn,
  marketingSmsOptIn,
  onMarketingChange,
}: {
  doc: DocPanel;
  accepted: boolean;
  onAcceptedChange: (next: boolean) => void;
  marketingEmailOptIn?: boolean;
  marketingSmsOptIn?: boolean;
  onMarketingChange?: (patch: Partial<OnboardingConsentsForm>) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [hasScrolledToEnd, setHasScrolledToEnd] = React.useState(accepted);
  const bodyRef = React.useRef<HTMLDivElement | null>(null);
  const [paragraphs] = React.useState(() => doc.body.split(/\n\n+/));

  // Track scroll position so we can disable the checkbox until the user
  // has scrolled to the bottom of the body — light-weight enforcement
  // that the document was at least exposed.
  function handleScroll() {
    const el = bodyRef.current;
    if (!el) return;
    const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
    if (atEnd) setHasScrolledToEnd(true);
  }

  return (
    <section
      className={cn(
        "rounded-md border bg-background",
        accepted ? "border-primary/40" : "border-border",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <div className="space-y-0.5">
          <p className="text-sm font-medium text-foreground">{doc.title}</p>
          <p className="caption text-muted-foreground">
            Version {doc.version}
            {accepted ? " · Accepted" : ""}
          </p>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
        )}
      </button>
      {open ? (
        <div className="space-y-3 border-t border-border px-4 py-4">
          <div
            ref={bodyRef}
            onScroll={handleScroll}
            className="max-h-72 space-y-3 overflow-y-auto rounded-md bg-muted/30 p-3 text-sm leading-relaxed text-foreground"
            tabIndex={0}
            role="region"
            aria-label={`${doc.title} body`}
          >
            {paragraphs.map((p, i) => (
              <p key={i} className="whitespace-pre-wrap">
                {p}
              </p>
            ))}
          </div>
          {!hasScrolledToEnd ? (
            <p className="caption text-muted-foreground">
              Scroll to the bottom to enable the acceptance tick box.
            </p>
          ) : null}
          {doc.key === "MARKETING" && onMarketingChange ? (
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <p className="text-sm font-medium text-foreground">Marketing channels</p>
              <p className="caption text-muted-foreground">
                Choose which channels you'd like to hear from us on. Optional.
              </p>
              <div className="mt-3 space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border accent-primary"
                    checked={marketingEmailOptIn ?? false}
                    onChange={(e) => onMarketingChange({ marketingEmailOptIn: e.target.checked })}
                  />
                  Email me news and offers
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border accent-primary"
                    checked={marketingSmsOptIn ?? false}
                    onChange={(e) => onMarketingChange({ marketingSmsOptIn: e.target.checked })}
                  />
                  Text me news and offers
                </label>
              </div>
            </div>
          ) : null}
          <label className="flex items-start gap-3 rounded-md border border-border bg-background p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-border accent-primary"
              checked={accepted}
              disabled={!hasScrolledToEnd}
              onChange={(e) => onAcceptedChange(e.target.checked)}
            />
            <span>
              I have read and accept the <strong>{doc.title}</strong> ({doc.version}).
            </span>
          </label>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
            >
              Collapse
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
