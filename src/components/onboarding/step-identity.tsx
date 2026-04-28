"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormGrid, FormGridRow } from "@/components/forms/form-grid";
import { AU_STATES } from "@/lib/validators/identity";
import {
  onboardingIdentitySchema,
  type OnboardingIdentityValues,
} from "@/lib/validators/onboarding";
import type { OnboardingIdentityForm, OnboardingIdentityPath } from "@/stores/onboarding-flow";
import { IdentityDocUploader } from "./identity-doc-uploader";

export interface StepIdentityProps {
  identityPath: Exclude<OnboardingIdentityPath, null>;
  initialValues: OnboardingIdentityForm;
  bindSubmit: (handler: () => Promise<OnboardingIdentityValues | null>) => void;
}

/**
 * Step 3 — identity documents. Renders different fields based on
 * `identityPath`. AU customers upload licence (front + optional back)
 * and type their licence triplet. International customers upload IDP
 * and passport, type both triplets.
 */
export function StepIdentity({ identityPath, initialValues, bindSubmit }: StepIdentityProps) {
  const form = useForm<OnboardingIdentityValues>({
    resolver: zodResolver(onboardingIdentitySchema),
    defaultValues: { ...initialValues, identityPath },
    mode: "onTouched",
  });

  // Keep `identityPath` synced if the user navigates back and changes
  // the gate. Without this, validation runs against the previous branch.
  React.useEffect(() => {
    form.setValue("identityPath", identityPath, { shouldValidate: false });
  }, [form, identityPath]);

  React.useEffect(() => {
    bindSubmit(async () => {
      const ok = await form.trigger();
      if (!ok) return null;
      return form.getValues();
    });
  }, [bindSubmit, form]);

  const isInternational = identityPath === "INTERNATIONAL";

  return (
    <Form {...form}>
      <form className="space-y-8">
        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="h3">
              {isInternational ? "International Driver's Permit" : "Driver's licence"}
            </h2>
            <p className="caption text-muted-foreground">
              We accept clear photos of either side of the document, or a PDF scan.
            </p>
          </div>

          <FormField
            control={form.control}
            name="licenceImageFrontKey"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <IdentityDocUploader
                    label={
                      isInternational
                        ? "Photo of your IDP"
                        : "Photo of the front of your licence"
                    }
                    description="Make sure all four corners are visible and the text is in focus."
                    imageKey={field.value || null}
                    onChange={(key) => field.onChange(key ?? "")}
                    required
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {!isInternational ? (
            <FormField
              control={form.control}
              name="licenceImageBackKey"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <IdentityDocUploader
                      label="Photo of the back of your licence (optional)"
                      description="Helps us verify your address and licence class."
                      imageKey={field.value || null}
                      onChange={(key) => field.onChange(key ?? "")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : null}

          <FormGrid cols={2}>
            <FormField
              control={form.control}
              name="licenceNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{isInternational ? "IDP number" : "Licence number"}</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="off" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {isInternational ? (
              <FormField
                control={form.control}
                name="licenceCountry"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Issuing country (2-letter code)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="US"
                        maxLength={2}
                        {...field}
                        onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : (
              <FormField
                control={form.control}
                name="licenceState"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Issuing state</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? ""}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select state" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {AU_STATES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={form.control}
              name="licenceExpiry"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Expiry date</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="licenceClass"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Class (optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="C, RE, R" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </FormGrid>
        </section>

        {isInternational ? (
          <section className="space-y-4">
            <div className="space-y-1">
              <h2 className="h3">Passport</h2>
              <p className="caption text-muted-foreground">
                Required alongside your IDP.
              </p>
            </div>

            <FormField
              control={form.control}
              name="passportImageKey"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <IdentityDocUploader
                      label="Photo of your passport bio-data page"
                      description="The page with your photo and details."
                      imageKey={field.value || null}
                      onChange={(key) => field.onChange(key ?? "")}
                      required
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormGrid cols={2}>
              <FormField
                control={form.control}
                name="passportNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Passport number</FormLabel>
                    <FormControl>
                      <Input {...field} autoComplete="off" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="passportCountry"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Issuing country (2-letter code)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="US"
                        maxLength={2}
                        {...field}
                        onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormGridRow>
                <FormField
                  control={form.control}
                  name="passportExpiry"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Expiry date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </FormGridRow>
            </FormGrid>
          </section>
        ) : null}
      </form>
    </Form>
  );
}
