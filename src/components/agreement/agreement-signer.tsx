"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { InitialsPad } from "./initials-pad";
import { SignaturePad } from "./signature-pad";

export type AgreementPage = {
  id: string;
  title: string;
  /** Render the page body. Renders above the initials area. */
  content: ReactNode;
  /** Whether the user must initial this page. Default true. */
  requiresInitials?: boolean;
  /** Disable Next until this predicate returns true (e.g. scrolled to bottom). */
  canAdvance?: () => boolean;
  /** Render an extra validation message when canAdvance is false. */
  advanceHelp?: string;
};

export type InitialsRecord = {
  pageId: string;
  initialsUrl: string;
  signedAt: string;
};

export type AgreementSignerProps = {
  pages: AgreementPage[];
  /** Existing initials captured so far (keyed by pageId). If all pages done, signer shows final signature step. */
  initialisedPages: InitialsRecord[];
  /** Called when the user captures initials on a page. */
  onInitials: (pageId: string, dataUrl: string) => void | Promise<void>;
  /** Called when the user captures the full customer signature on the final page. */
  onCustomerSignature: (dataUrl: string) => void | Promise<void>;
  /** Called when the staff captures their counter-signature. */
  onStaffSignature: (dataUrl: string) => void | Promise<void>;
  /** Existing full signatures (prefilled on revisit). */
  existingCustomerSignatureUrl?: string | null;
  existingStaffSignatureUrl?: string | null;
  /** Called when both signatures are captured and the user taps Submit. */
  onSubmit: () => void | Promise<void>;
  /** Submission loading state. */
  submitting?: boolean;
  /** Optional: the final signature page body (injected above the sig-pads). */
  finalPageContent?: ReactNode;
  /** Branding strip at the top of the wizard. */
  title: string;
  subtitle?: string;
};

/**
 * Generic multi-page agreement signer. Shared between the pickup rental
 * agreement and the return assessment — each supplies its own ordered pages.
 *
 * UX conventions:
 * - Pen-first (tablet) with large hit targets.
 * - Initials captured once (first time) then re-applied per page with an
 *   explicit "Apply" tap so each page has an independent timestamp.
 * - Back is allowed up to (but not including) Submit.
 */
export function AgreementSigner(props: AgreementSignerProps) {
  const {
    pages,
    initialisedPages,
    onInitials,
    onCustomerSignature,
    onStaffSignature,
    existingCustomerSignatureUrl,
    existingStaffSignatureUrl,
    onSubmit,
    submitting,
    finalPageContent,
    title,
    subtitle,
  } = props;

  const [index, setIndex] = useState(0);
  const totalSteps = pages.length + 1; // + final signature page

  const initialsUrlByPage = useMemo(
    () => Object.fromEntries(initialisedPages.map((p) => [p.pageId, p.initialsUrl])),
    [initialisedPages],
  );
  const firstInitials = initialisedPages[0]?.initialsUrl ?? null;

  const onFinalPage = index >= pages.length;
  const currentPage = onFinalPage ? null : pages[index];

  const allInitialled = pages
    .filter((p) => p.requiresInitials !== false)
    .every((p) => initialsUrlByPage[p.id]);
  const bothSignatures = !!existingCustomerSignatureUrl && !!existingStaffSignatureUrl;

  return (
    <div className="flex min-h-[70vh] flex-col gap-4">
      <header className="rounded-md border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="h3 leading-tight">{title}</h2>
            {subtitle && <p className="caption">{subtitle}</p>}
          </div>
          <div className="text-xs text-muted-foreground">
            Step {Math.min(index + 1, totalSteps)} / {totalSteps}
          </div>
        </div>
        <Progress step={index + 1} total={totalSteps} />
      </header>

      <section className="flex-1 rounded-md border border-border bg-card p-6">
        {currentPage ? (
          <PageFrame
            page={currentPage}
            initialsUrl={initialsUrlByPage[currentPage.id] ?? null}
            firstInitials={firstInitials}
            onInitials={(url) => onInitials(currentPage.id, url)}
          />
        ) : (
          <FinalSignaturePage
            customerSignatureUrl={existingCustomerSignatureUrl ?? null}
            staffSignatureUrl={existingStaffSignatureUrl ?? null}
            onCustomerSignature={onCustomerSignature}
            onStaffSignature={onStaffSignature}
            extraContent={finalPageContent}
          />
        )}
      </section>

      <footer className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="secondary"
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0 || submitting}
        >
          Back
        </Button>
        {!onFinalPage ? (
          <AdvanceButton
            page={currentPage!}
            hasInitials={!!initialsUrlByPage[currentPage!.id]}
            onClick={() => setIndex((i) => i + 1)}
          />
        ) : (
          <Button
            type="button"
            onClick={onSubmit}
            disabled={submitting || !allInitialled || !bothSignatures}
          >
            {submitting ? "Sealing…" : "Submit signed agreement"}
          </Button>
        )}
      </footer>
    </div>
  );
}

function Progress({ step, total }: { step: number; total: number }) {
  const pct = Math.min(100, Math.round((step / total) * 100));
  return (
    <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-muted">
      <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

function PageFrame({
  page,
  initialsUrl,
  firstInitials,
  onInitials,
}: {
  page: AgreementPage;
  initialsUrl: string | null;
  firstInitials: string | null;
  onInitials: (url: string) => void | Promise<void>;
}) {
  const requiresInitials = page.requiresInitials !== false;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="h3 mb-3">{page.title}</h3>
        <div className="body-text space-y-3">{page.content}</div>
      </div>
      {requiresInitials && (
        <InitialsCapture initialsUrl={initialsUrl} firstInitials={firstInitials} onCapture={onInitials} />
      )}
    </div>
  );
}

function InitialsCapture({
  initialsUrl,
  firstInitials,
  onCapture,
}: {
  initialsUrl: string | null;
  firstInitials: string | null;
  onCapture: (url: string) => void | Promise<void>;
}) {
  // Show first-time pad if no prior initials exist anywhere yet. Otherwise
  // show the stored first-ever initials and an "Apply" button that re-records.
  const needsFresh = !firstInitials && !initialsUrl;
  const applied = !!initialsUrl;
  return (
    <div className="rounded-md border border-border bg-muted/30 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="eyebrow">Customer initials</div>
          <p className="caption mt-1">
            {needsFresh
              ? "Please draw your initials below — they'll be re-applied to every subsequent page of this agreement."
              : applied
                ? "Applied to this page."
                : "Tap Apply to record your initials on this page."}
          </p>
        </div>
        {applied && firstInitials && (
          <div className="h-14 w-20 overflow-hidden rounded border border-border bg-background">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={firstInitials} alt="initials" className="h-full w-full object-contain" />
          </div>
        )}
      </div>
      {needsFresh ? (
        <div className="mt-3">
          {/* Lazy import avoided — SignaturePad is small. */}
          <FreshInitials onAccept={onCapture} />
        </div>
      ) : !applied ? (
        <div className="mt-3">
          <Button type="button" size="sm" onClick={() => firstInitials && onCapture(firstInitials)}>
            Apply initials to this page
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function FreshInitials({ onAccept }: { onAccept: (url: string) => void | Promise<void> }) {
  return <InitialsPad onAccept={onAccept} />;
}

function FinalSignaturePage({
  customerSignatureUrl,
  staffSignatureUrl,
  onCustomerSignature,
  onStaffSignature,
  extraContent,
}: {
  customerSignatureUrl: string | null;
  staffSignatureUrl: string | null;
  onCustomerSignature: (url: string) => void | Promise<void>;
  onStaffSignature: (url: string) => void | Promise<void>;
  extraContent?: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="h3">Final signatures</h3>
        <p className="body-text">
          Please sign in full below. The staff witness will then counter-sign, and the agreement will be sealed.
        </p>
      </div>
      {extraContent}
      <div className={cn("grid gap-6 md:grid-cols-2")}>
        <div>
          <div className="eyebrow mb-2">Customer signature</div>
          <SignaturePad
            aspectRatio={3}
            label="Customer signs here"
            existingUrl={customerSignatureUrl}
            onAccept={onCustomerSignature}
          />
        </div>
        <div>
          <div className="eyebrow mb-2">Staff witness signature</div>
          <SignaturePad
            aspectRatio={3}
            label="Staff signs here"
            existingUrl={staffSignatureUrl}
            onAccept={onStaffSignature}
          />
        </div>
      </div>
    </div>
  );
}

function AdvanceButton({
  page,
  hasInitials,
  onClick,
}: {
  page: AgreementPage;
  hasInitials: boolean;
  onClick: () => void;
}) {
  const custom = page.canAdvance?.() ?? true;
  const requiresInitials = page.requiresInitials !== false;
  const disabled = (requiresInitials && !hasInitials) || !custom;
  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" onClick={onClick} disabled={disabled}>
        Next
      </Button>
      {!custom && page.advanceHelp && (
        <span className="text-xs text-muted-foreground">{page.advanceHelp}</span>
      )}
    </div>
  );
}
