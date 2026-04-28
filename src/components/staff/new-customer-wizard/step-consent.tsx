"use client";

import * as React from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { Hand, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { trpc } from "@/lib/trpc/client";
import { CONSENT_DOC_KEYS, getConsentDocument, type ConsentDocKey } from "@/lib/consent-documents";
import { ConsentDocumentViewer, type SignedResult } from "./consent-document-viewer";
import type { WizardFormValues } from "./wizard-types";

export function StepConsent() {
  const form = useFormContext<WizardFormValues>();
  const signedConsents = useWatch({ control: form.control, name: "signedConsents" });
  const firstName = useWatch({ control: form.control, name: "firstName" });
  const lastName = useWatch({ control: form.control, name: "lastName" });
  const signatureUrl = useWatch({ control: form.control, name: "signatureUrl" });
  const marketingEmail = useWatch({ control: form.control, name: "marketingEmailOptIn" });
  const marketingSms = useWatch({ control: form.control, name: "marketingSmsOptIn" });

  const generate = trpc.staffCustomer.generateConsentPdf.useMutation();

  // Index the current progress: which docKey is "next" to sign.
  const signedByKey = React.useMemo(() => {
    const map = new Map<ConsentDocKey, SignedResult>();
    for (const c of signedConsents ?? []) {
      map.set(c.docKey, {
        docKey: c.docKey,
        fileKey: c.fileKey,
        fileUrl: c.fileUrl,
        docVersion: c.docVersion,
        signedAt: c.signedAt,
      });
    }
    return map;
  }, [signedConsents]);

  const activeKey = React.useMemo<ConsentDocKey | null>(() => {
    for (const key of CONSENT_DOC_KEYS) {
      if (!signedByKey.has(key)) return key;
    }
    return null;
  }, [signedByKey]);

  async function signDoc(args: {
    docKey: ConsentDocKey;
    signatureDataUrl?: string;
    useExisting: boolean;
  }): Promise<SignedResult> {
    const signedAt = new Date().toISOString();
    const result = await generate.mutateAsync({
      docKey: args.docKey,
      firstName: firstName || "",
      lastName: lastName || "",
      signedAt,
      signatureDataUrl: args.signatureDataUrl,
      signatureKey:
        args.useExisting
          ? form.getValues("signatureKey") || undefined
          : undefined,
      marketingChoices:
        args.docKey === "MARKETING"
          ? { email: !!marketingEmail, sms: !!marketingSms }
          : undefined,
    });

    // Persist signature references on the form so subsequent docs can reuse.
    if (args.signatureDataUrl && !form.getValues("signatureKey")) {
      form.setValue("signatureDataUrl", args.signatureDataUrl, { shouldDirty: true });
      form.setValue("signatureKey", result.signatureKey, { shouldDirty: true });
      form.setValue("signatureUrl", result.signatureUrl, { shouldDirty: true });
    }

    const entry = {
      docKey: args.docKey,
      fileKey: result.fileKey,
      fileUrl: result.fileUrl,
      docVersion: result.docVersion,
      signedAt,
    };
    const next = [
      ...(form.getValues("signedConsents") ?? []).filter((c) => c.docKey !== args.docKey),
      entry,
    ];
    form.setValue("signedConsents", next, { shouldDirty: true, shouldValidate: true });
    form.clearErrors("signedConsents");

    return { ...entry, signatureKey: result.signatureKey, signatureUrl: result.signatureUrl };
  }

  function updateMarketing(choices: { email: boolean; sms: boolean }) {
    form.setValue("marketingEmailOptIn", choices.email, { shouldDirty: true });
    form.setValue("marketingSmsOptIn", choices.sms, { shouldDirty: true });
  }

  return (
    <div className="space-y-6">
      <Card className="border-primary/40 bg-primary/5">
        <CardContent className="flex items-start gap-3 py-4">
          <Hand className="mt-0.5 h-5 w-5 text-primary" />
          <div>
            <p className="text-sm font-medium text-primary">
              Please hand the tablet to the customer.
            </p>
            <p className="text-caption text-muted-foreground">
              They&apos;ll read and sign each document below. Signatures are captured
              once and reused across documents — they can opt to re-sign any
              individual document.
            </p>
          </div>
        </CardContent>
      </Card>

      <ol className="flex flex-wrap items-center gap-2 text-caption">
        {CONSENT_DOC_KEYS.map((k, i) => {
          const done = signedByKey.has(k);
          const active = k === activeKey;
          return (
            <li
              key={k}
              className={
                "flex items-center gap-1.5 rounded-full border px-2 py-0.5 " +
                (done
                  ? "border-primary bg-primary/10 text-primary"
                  : active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-muted-foreground")
              }
            >
              {done ? <CheckCircle2 className="h-3 w-3" /> : <span>{i + 1}</span>}
              <span>{getConsentDocument(k).title}</span>
            </li>
          );
        })}
      </ol>

      {CONSENT_DOC_KEYS.map((key) => {
        const signed = signedByKey.get(key) ?? null;
        const isActive = key === activeKey;
        if (!signed && !isActive) return null;
        return (
          <ConsentDocumentViewer
            key={key}
            docKey={key}
            reuseSignatureUrl={signatureUrl ?? null}
            signed={signed}
            onSign={signDoc}
            marketingChoices={
              key === "MARKETING"
                ? { email: !!marketingEmail, sms: !!marketingSms }
                : undefined
            }
            onMarketingChange={key === "MARKETING" ? updateMarketing : undefined}
          />
        );
      })}

      {activeKey === null && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="py-4 text-sm">
            All four documents signed. Hand the tablet back to staff and tap
            <span className="font-semibold"> Next </span>to continue.
          </CardContent>
        </Card>
      )}

      {form.formState.errors.signedConsents && (
        <p className="text-sm text-destructive">
          {form.formState.errors.signedConsents.message ??
            "Please sign all four consent documents before continuing."}
        </p>
      )}
    </div>
  );
}
