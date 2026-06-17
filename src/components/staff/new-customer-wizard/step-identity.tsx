"use client";

import * as React from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc/client";
import { IdDropZone, type OcrStatus } from "./id-drop-zone";
import { AU_STATES, type WizardFormValues } from "./wizard-types";

export function StepIdentity() {
  const form = useFormContext<WizardFormValues>();
  const isInternational = useWatch({ control: form.control, name: "isInternational" });

  const [licenceOcr, setLicenceOcr] = React.useState<OcrStatus>({ kind: "idle" });
  const [passportOcr, setPassportOcr] = React.useState<OcrStatus>({ kind: "idle" });
  const [licenceFields, setLicenceFields] = React.useState<DetectedSummary | null>(null);
  const [passportFields, setPassportFields] = React.useState<DetectedSummary | null>(null);

  const extractLicence = trpc.customer.extractLicenceFromImage.useMutation();
  const extractPassport = trpc.customer.extractPassportFromImage.useMutation();

  async function runLicenceOcr(imageKey: string) {
    setLicenceOcr({ kind: "running" });
    try {
      const result = await extractLicence.mutateAsync({ imageKey });
      // Reject a genuine non-ID image: clear the slot so it isn't carried to
      // submit. A passport (the other valid ID) is left in place but won't
      // pre-fill — the extractor returns no cross-type fields.
      if (result.documentType === "OTHER") {
        form.setValue("licenceImageFront", "", { shouldDirty: true });
        setLicenceFields(null);
        setLicenceOcr({ kind: "failed", message: "Not a driver's licence" });
        return;
      }
      const populated = applyLicencePrefill(form, result);
      setLicenceFields({
        "Licence #": result.licenceNumber,
        State: result.state,
        "First name": result.firstName,
        "Last name": result.lastName,
        DOB: toIsoDate(result.dateOfBirth),
        Expiry: toIsoDate(result.expiryDate),
        Class: result.licenceClass,
        Address: joinAddress(result.addressLine1, result.suburb, result.addressState, result.postcode),
      });
      setLicenceOcr({
        kind: populated > 0 ? "done" : "empty",
        confidence: result.confidence,
        fieldsPopulated: populated,
      });
    } catch (e) {
      setLicenceOcr({ kind: "failed", message: e instanceof Error ? e.message : undefined });
    }
  }

  async function runPassportOcr(imageKey: string) {
    setPassportOcr({ kind: "running" });
    try {
      const result = await extractPassport.mutateAsync({ imageKey });
      // Reject a genuine non-ID image: clear the slot so it isn't carried to
      // submit. A licence (the other valid ID) is left in place but won't
      // pre-fill — the extractor returns no cross-type fields.
      if (result.documentType === "OTHER") {
        form.setValue("passportImage", "", { shouldDirty: true });
        setPassportFields(null);
        setPassportOcr({ kind: "failed", message: "Not a passport" });
        return;
      }
      const populated = applyPassportPrefill(form, result);
      setPassportFields({
        "Passport #": result.passportNumber,
        Country: result.country,
        "First name": result.firstName,
        "Last name": result.lastName,
        DOB: toIsoDate(result.dateOfBirth),
        Expiry: toIsoDate(result.expiryDate),
      });
      setPassportOcr({
        kind: populated > 0 ? "done" : "empty",
        confidence: result.confidence,
        fieldsPopulated: populated,
      });
    } catch (e) {
      setPassportOcr({ kind: "failed", message: e instanceof Error ? e.message : undefined });
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Identity documents</CardTitle>
          <p className="text-caption text-muted-foreground">
            Drop a passport and/or a driver&apos;s licence. AI will read the image and
            pre-fill the next step — you can review and correct before moving on.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={isInternational}
                onChange={(e) =>
                  form.setValue("isInternational", e.target.checked, { shouldDirty: true })
                }
                className="mt-1"
              />
              <span>
                <span className="font-medium">International customer</span>
                <span className="block text-muted-foreground">
                  A passport is required; a licence is optional and can be added
                  below or in step 2 with any visa / international driving permit.
                </span>
              </span>
            </label>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <IdDropZone
              label="Passport"
              hint="Used for identity verification. Required for international customers."
              value={form.watch("passportImage") ?? ""}
              onChange={(url) =>
                form.setValue("passportImage", url, { shouldDirty: true })
              }
              onUploaded={(r) => runPassportOcr(r.key)}
              ocrStatus={passportOcr}
            />
            <div className="space-y-3">
              <IdDropZone
                label="Licence — front"
                hint="Main identity side with photo and licence number."
                value={form.watch("licenceImageFront") ?? ""}
                onChange={(url) =>
                  form.setValue("licenceImageFront", url, { shouldDirty: true })
                }
                onUploaded={(r) => runLicenceOcr(r.key)}
                ocrStatus={licenceOcr}
              />
              <IdDropZone
                label="Licence — back"
                hint="Optional — used for address verification where applicable."
                value={form.watch("licenceImageBack") ?? ""}
                onChange={(url) =>
                  form.setValue("licenceImageBack", url, { shouldDirty: true })
                }
              />
            </div>
          </div>

          {licenceFields && <DetectedPanel title="Detected from licence" fields={licenceFields} />}
          {passportFields && <DetectedPanel title="Detected from passport" fields={passportFields} />}
        </CardContent>
      </Card>
    </div>
  );
}

type DetectedSummary = Record<string, string | undefined>;

function DetectedPanel({ title, fields }: { title: string; fields: DetectedSummary }) {
  const entries = Object.entries(fields).filter(([, v]) => !!v && v.length > 0);
  if (entries.length === 0) return null;
  return (
    <div className="rounded-md border bg-muted/30 p-4">
      <p className="mb-2 text-caption font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <dl className="grid gap-2 text-sm md:grid-cols-2">
        {entries.map(([k, v]) => (
          <div key={k} className="flex flex-col">
            <dt className="text-caption text-muted-foreground">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-caption text-muted-foreground">
        Step 2 shows the fields — review and correct anything the AI got wrong.
      </p>
    </div>
  );
}

function toIsoDate(d: Date | string | undefined): string | undefined {
  if (!d) return undefined;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

function joinAddress(
  line1?: string,
  suburb?: string,
  state?: string,
  postcode?: string,
): string | undefined {
  const parts = [line1, [suburb, state, postcode].filter(Boolean).join(" ")].filter(
    (p) => p && p.length > 0,
  );
  return parts.length > 0 ? parts.join(", ") : undefined;
}

/**
 * Write non-empty licence OCR fields into the form. Only overwrites fields
 * that are currently empty so staff edits aren't clobbered on re-upload.
 */
function applyLicencePrefill(
  form: ReturnType<typeof useFormContext<WizardFormValues>>,
  result: {
    licenceNumber?: string;
    state?: string;
    firstName?: string;
    lastName?: string;
    dateOfBirth?: Date | string;
    expiryDate?: Date | string;
    licenceClass?: string;
    addressLine1?: string;
    addressLine2?: string;
    suburb?: string;
    addressState?: string;
    postcode?: string;
  },
): number {
  let count = 0;
  const setIfEmpty = (name: keyof WizardFormValues, value: string | undefined) => {
    if (!value) return;
    const current = form.getValues(name);
    if (typeof current === "string" && current !== "") return;
    form.setValue(name, value as never, { shouldDirty: true });
    count += 1;
  };
  setIfEmpty("licenceNumber", result.licenceNumber);
  if (result.state) {
    const upper = result.state.toUpperCase();
    if ((AU_STATES as readonly string[]).includes(upper)) setIfEmpty("licenceState", upper);
  }
  setIfEmpty("licenceClass", result.licenceClass);
  setIfEmpty("firstName", result.firstName);
  setIfEmpty("lastName", result.lastName);
  setIfEmpty("dateOfBirth", toIsoDate(result.dateOfBirth));
  setIfEmpty("licenceExpiry", toIsoDate(result.expiryDate));

  setIfEmpty("addressLine1", result.addressLine1);
  setIfEmpty("addressLine2", result.addressLine2);
  setIfEmpty("suburb", result.suburb);
  if (result.addressState) {
    const upper = result.addressState.toUpperCase();
    if ((AU_STATES as readonly string[]).includes(upper)) setIfEmpty("state", upper);
  }
  setIfEmpty("postcode", result.postcode);
  return count;
}

function applyPassportPrefill(
  form: ReturnType<typeof useFormContext<WizardFormValues>>,
  result: {
    passportNumber?: string;
    country?: string;
    firstName?: string;
    lastName?: string;
    dateOfBirth?: Date | string;
    expiryDate?: Date | string;
  },
): number {
  let count = 0;
  const setIfEmpty = (name: keyof WizardFormValues, value: string | undefined) => {
    if (!value) return;
    const current = form.getValues(name);
    if (typeof current === "string" && current !== "") return;
    form.setValue(name, value as never, { shouldDirty: true });
    count += 1;
  };
  setIfEmpty("passportNumber", result.passportNumber);
  setIfEmpty("passportCountry", result.country);
  setIfEmpty("firstName", result.firstName);
  setIfEmpty("lastName", result.lastName);
  setIfEmpty("dateOfBirth", toIsoDate(result.dateOfBirth));
  setIfEmpty("passportExpiry", toIsoDate(result.expiryDate));
  return count;
}
