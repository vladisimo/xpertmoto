"use client";

import { useFormContext, useWatch } from "react-hook-form";
import { CheckCircle2, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getConsentDocument } from "@/lib/consent-documents";
import type { WizardFormValues } from "./wizard-types";

export function StepReview() {
  const form = useFormContext<WizardFormValues>();
  const v = useWatch({ control: form.control }) as WizardFormValues;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Summary</CardTitle>
          <p className="text-caption text-muted-foreground">
            Review and tap <span className="font-semibold">Create customer</span> to
            save, attach signed documents, and send the welcome email.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-[auto_1fr]">
            {v.customerPhotoUrl ? (
              <div className="overflow-hidden rounded-md border bg-muted/30">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={v.customerPhotoUrl}
                  alt={`${v.firstName} ${v.lastName}`}
                  className="h-32 w-32 object-cover"
                />
              </div>
            ) : (
              <div className="flex h-32 w-32 items-center justify-center rounded-md border bg-muted/30 text-caption text-muted-foreground">
                No photo
              </div>
            )}
            <dl className="grid gap-4 text-sm md:grid-cols-2">
              <Field label="Name" value={`${v.firstName} ${v.lastName}`.trim()} />
              <Field label="Email" value={v.email} />
              <Field label="Phone" value={v.phone} />
              <Field label="Date of birth" value={v.dateOfBirth} />
              <Field
                label="Address"
                value={formatAddress(v)}
              />
              <Field
                label={v.isInternational ? "Passport" : "Licence"}
                value={
                  v.isInternational
                    ? [v.passportNumber, v.passportCountry, v.passportExpiry]
                        .filter(Boolean)
                        .join(" · ")
                    : [v.licenceNumber, v.licenceState, v.licenceClass, v.licenceExpiry]
                        .filter(Boolean)
                        .join(" · ")
                }
              />
              <Field
                label="Emergency contact"
                value={
                  [
                    v.emergencyContactName,
                    v.emergencyContactPhone,
                    v.emergencyContactRelationship,
                  ]
                    .filter(Boolean)
                    .join(" · ") || undefined
                }
              />
              <Field
                label="Marketing"
                value={
                  v.marketingEmailOptIn || v.marketingSmsOptIn
                    ? [v.marketingEmailOptIn ? "Email" : null, v.marketingSmsOptIn ? "SMS" : null]
                        .filter(Boolean)
                        .join(" + ")
                    : "None"
                }
              />
            </dl>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Signed documents</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {v.signedConsents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No consent documents signed.</p>
          ) : (
            <ul className="space-y-1.5">
              {v.signedConsents.map((c) => (
                <li key={c.docKey} className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span>{getConsentDocument(c.docKey).title}</span>
                  <span className="text-muted-foreground">· {c.docVersion}</span>
                  <span className="text-muted-foreground">
                    · {new Date(c.signedAt).toLocaleString("en-AU")}
                  </span>
                  <a
                    href={c.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto inline-flex items-center gap-1 text-primary underline"
                  >
                    <FileText className="h-3 w-3" />
                    PDF
                  </a>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {(v.licenceImageFront || v.licenceImageBack || v.passportImage || v.documents.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Attached files</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {v.passportImage && <FileLink label="Passport" url={v.passportImage} />}
            {v.licenceImageFront && <FileLink label="Licence — front" url={v.licenceImageFront} />}
            {v.licenceImageBack && <FileLink label="Licence — back" url={v.licenceImageBack} />}
            {v.documents.map((d, i) => (
              <FileLink key={i} label={d.label || d.type} url={d.fileUrl} />
            ))}
          </CardContent>
        </Card>
      )}

      {v.staffNote && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Internal staff note</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{v.staffNote}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

function FileLink({ label, url }: { label: string; url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-primary underline"
    >
      <FileText className="h-3 w-3" />
      {label}
    </a>
  );
}

function formatAddress(v: WizardFormValues): string | undefined {
  const parts = [
    v.addressLine1,
    v.addressLine2,
    [v.suburb, v.state, v.postcode].filter(Boolean).join(" "),
    v.country,
  ].filter((p) => p && p.length > 0);
  return parts.length > 0 ? parts.join(", ") : undefined;
}
