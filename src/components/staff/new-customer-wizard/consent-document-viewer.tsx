"use client";

import * as React from "react";
import { CheckCircle2, Loader2, PenTool, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DocumentViewerButton } from "@/components/shared/document-viewer-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SignaturePad } from "@/components/agreement/signature-pad";
import {
  getConsentDocument,
  interpolateConsentBody,
  type ConsentDocKey,
} from "@/lib/consent-documents";
import { useBranding } from "@/components/shared/branding-provider";
import { cn } from "@/lib/utils";

export type SignedResult = {
  docKey: ConsentDocKey;
  fileKey: string;
  fileUrl: string;
  docVersion: string;
  signedAt: string;
  /** New signature PNG uploaded for this doc (only set on the first sign). */
  signatureKey?: string;
  signatureUrl?: string;
};

export type ConsentDocumentViewerProps = {
  docKey: ConsentDocKey;
  /** If provided, we reuse this existing signature instead of capturing a fresh one. */
  reuseSignatureUrl?: string | null;
  /** Called when the customer taps "Accept & sign". The parent generates the PDF. */
  onSign: (args: {
    docKey: ConsentDocKey;
    signatureDataUrl?: string;
    useExisting: boolean;
  }) => Promise<SignedResult>;
  /** Previously-signed result (if any) — the doc renders in "signed" state. */
  signed?: SignedResult | null;
  /** Marketing flow only — channel choices passed to the parent for the PDF. */
  marketingChoices?: { email: boolean; sms: boolean };
  onMarketingChange?: (choices: { email: boolean; sms: boolean }) => void;
};

export function ConsentDocumentViewer({
  docKey,
  reuseSignatureUrl,
  onSign,
  signed,
  marketingChoices,
  onMarketingChange,
}: ConsentDocumentViewerProps) {
  const doc = getConsentDocument(docKey);
  const branding = useBranding();
  const interpolatedBody = React.useMemo(
    () =>
      interpolateConsentBody(doc.body, {
        siteName: branding.siteName,
        legalName: branding.legalName,
        abn: branding.abn,
        supportEmail: branding.supportEmail,
        privacyEmail: branding.privacyEmail,
      }),
    [doc.body, branding],
  );
  const [scrolledToBottom, setScrolledToBottom] = React.useState(false);
  const [isSigning, setIsSigning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<"reuse" | "fresh">(
    reuseSignatureUrl ? "reuse" : "fresh",
  );

  const bodyRef = React.useRef<HTMLDivElement | null>(null);

  // Autosize check — a short doc that's visible on first render counts as
  // "scrolled to bottom" immediately so the accept action isn't blocked.
  React.useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (el.scrollHeight <= el.clientHeight + 4) setScrolledToBottom(true);
  }, [docKey]);

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) {
      setScrolledToBottom(true);
    }
  }

  async function handleSign(dataUrl?: string) {
    setError(null);
    setIsSigning(true);
    try {
      await onSign({
        docKey,
        signatureDataUrl: dataUrl,
        useExisting: mode === "reuse" && !dataUrl,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to sign");
    } finally {
      setIsSigning(false);
    }
  }

  if (signed) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            {doc.title} — signed
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            Signed {new Date(signed.signedAt).toLocaleString("en-AU")} · {signed.docVersion}
          </p>
          <DocumentViewerButton
            fileUrl={signed.fileUrl}
            title={`${doc.title} — signed`}
            description={signed.docVersion}
            kind="pdf"
            variant="link"
            size="sm"
            className="h-auto px-0"
          >
            View signed PDF
          </DocumentViewerButton>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{doc.title}</CardTitle>
        <p className="text-caption text-muted-foreground">
          Please read, then sign below. A signed PDF will be added to your file.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          ref={bodyRef}
          onScroll={handleScroll}
          className="max-h-[320px] overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/20 p-4 text-sm leading-relaxed"
        >
          {interpolatedBody}
        </div>

        {docKey === "MARKETING" && marketingChoices && onMarketingChange && (
          <div className="space-y-2 rounded-md border border-dashed p-4">
            <p className="text-sm font-medium">Marketing channels</p>
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={marketingChoices.email}
                onChange={(e) =>
                  onMarketingChange({ ...marketingChoices, email: e.target.checked })
                }
              />
              <span>
                <span className="font-medium">Email</span>
                <span className="block text-muted-foreground">
                  Promotions, seasonal offers, newsletter.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={marketingChoices.sms}
                onChange={(e) =>
                  onMarketingChange({ ...marketingChoices, sms: e.target.checked })
                }
              />
              <span>
                <span className="font-medium">SMS</span>
                <span className="block text-muted-foreground">
                  Time-sensitive offers and reminders by text.
                </span>
              </span>
            </label>
          </div>
        )}

        {!scrolledToBottom && (
          <p className="text-caption text-muted-foreground">
            Scroll to the end of the document to continue.
          </p>
        )}

        {reuseSignatureUrl && mode === "reuse" ? (
          <div className="space-y-3">
            <div className={cn("flex items-center gap-3 rounded-md border p-3")}>
              <span className="text-caption text-muted-foreground">
                Signature on file
              </span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={reuseSignatureUrl}
                alt="Customer signature"
                className="h-12 w-auto"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => handleSign()}
                disabled={!scrolledToBottom || isSigning}
              >
                {isSigning ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Accepting…
                  </>
                ) : (
                  <>
                    <PenTool className="h-4 w-4" />
                    Accept with signature on file
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setMode("fresh")}
                disabled={isSigning}
              >
                <RotateCcw className="h-4 w-4" />
                Re-sign this document
              </Button>
            </div>
          </div>
        ) : (
          <SignaturePad
            aspectRatio={3}
            label="Customer signature"
            acceptLabel={isSigning ? "Accepting…" : "Accept & sign"}
            onAccept={(dataUrl) => handleSign(dataUrl)}
            disabled={isSigning || !scrolledToBottom}
          />
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
