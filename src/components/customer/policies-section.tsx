"use client";

import { Download } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { PageSection } from "@/components/layout/page-section";
import { Button } from "@/components/ui/button";
import { LoadingBlock } from "@/components/ui/spinner";
import { formatDate } from "@/lib/utils";
import { useDocumentAccessLogger } from "@/hooks/use-document-access-logger";

const CONSENT_TITLE: Record<string, string> = {
  CONSENT_TERMS: "Terms of Hire",
  CONSENT_PRIVACY: "Privacy Policy",
  CONSENT_CANCELLATION: "Cancellation Policy",
  CONSENT_MARKETING: "Marketing Consent",
};

const CONSENT_ORDER = [
  "CONSENT_TERMS",
  "CONSENT_PRIVACY",
  "CONSENT_CANCELLATION",
  "CONSENT_MARKETING",
] as const;

export function PoliciesSection() {
  const q = trpc.customer.signedConsents.useQuery();
  const logAccess = useDocumentAccessLogger();

  if (q.isLoading) {
    return (
      <PageSection
        title="Signed policies"
        collapsible
        name="customer-docs"
        className="p-4"
      >
        <LoadingBlock />
      </PageSection>
    );
  }

  const rows = q.data ?? [];
  const byType = new Map(rows.map((r) => [r.type, r]));
  const ordered = CONSENT_ORDER.map((type) => ({
    type,
    title: CONSENT_TITLE[type] ?? type,
    row: byType.get(type) ?? null,
  }));

  const hasAny = ordered.some((o) => o.row);

  return (
    <PageSection
      title="Signed policies"
      collapsible
      name="customer-docs"
      className="p-4"
    >
      {hasAny ? (
        <ul className="divide-y rounded-md border bg-card">
          {ordered.map((o) => {
            if (!o.row) return null;
            const signedAt = o.row.signedAt ? new Date(o.row.signedAt) : null;
            return (
              <li
                key={o.type}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <div className="min-w-0 flex-1 flex flex-wrap items-baseline gap-x-2">
                  <span className="truncate text-sm font-medium">{o.title}</span>
                  {(o.row.docVersion || signedAt) && (
                    <span className="truncate text-caption text-muted-foreground">
                      {o.row.docVersion ?? null}
                      {o.row.docVersion && signedAt ? " · " : null}
                      {signedAt ? formatDate(signedAt) : null}
                    </span>
                  )}
                </div>
                <Button asChild variant="ghost" size="icon" aria-label={`Download ${o.title}`}>
                  <a
                    href={o.row.signedUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    download
                    onClick={() =>
                      logAccess({ documentId: o.row!.id, reason: "download" })
                    }
                  >
                    <Download className="h-4 w-4" aria-hidden />
                  </a>
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          You don&rsquo;t have any signed policy documents on file yet. Staff
          will collect your signatures on the Terms of Hire, Privacy Policy,
          Cancellation Policy, and Marketing Consent when you complete
          onboarding at the depot.
        </p>
      )}
    </PageSection>
  );
}
