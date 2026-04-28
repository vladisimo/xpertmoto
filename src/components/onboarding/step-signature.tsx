"use client";

import * as React from "react";
import { Check } from "lucide-react";

import { SignaturePad } from "@/components/agreement/signature-pad";
import { cn } from "@/lib/utils";

export interface StepSignatureProps {
  customerFullName: string;
  signatureDataUrl: string | null;
  onSignatureChange: (dataUrl: string | null) => void;
}

/**
 * Step 5 — capture a single signature. The same PNG is embedded in the
 * bottom-right footer of every page of all four signed PDFs by
 * `onboarding.generateSignedPdfs`. Reuses the canvas-backed
 * `<SignaturePad>` already in production for staff check-out.
 */
export function StepSignature({
  customerFullName,
  signatureDataUrl,
  onSignatureChange,
}: StepSignatureProps) {
  return (
    <div className="space-y-5">
      <div className="rounded-md border border-border bg-muted/30 p-4 text-sm">
        <p className="text-foreground">
          By signing below, you confirm that you have read and accepted
          all four documents on the previous step. Your signature is
          embedded into a PDF copy of each document so you and our staff
          can refer back to them at any time.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">
          Signing as <span className="text-foreground">{customerFullName}</span>
        </p>
        <p className="caption text-muted-foreground">
          Use a stylus on a tablet or your finger on a phone for best results.
        </p>
      </div>

      <div
        className={cn(
          "rounded-md border bg-background p-4",
          signatureDataUrl ? "border-primary/40" : "border-border",
        )}
      >
        {signatureDataUrl ? (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-md border border-border bg-muted/20 p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={signatureDataUrl}
                alt="Your signature"
                className="mx-auto h-32 max-w-full object-contain"
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="caption flex items-center gap-2 text-primary">
                <Check className="h-4 w-4" /> Signature captured
              </p>
              <button
                type="button"
                onClick={() => onSignatureChange(null)}
                className="caption text-muted-foreground underline-offset-4 hover:underline"
              >
                Clear and re-sign
              </button>
            </div>
          </div>
        ) : (
          <SignaturePad
            aspectRatio={3}
            label="Sign here"
            onAccept={(dataUrl) => onSignatureChange(dataUrl)}
          />
        )}
      </div>
    </div>
  );
}
