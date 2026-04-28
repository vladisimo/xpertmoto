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
import { FormGrid, FormGridRow } from "@/components/forms/form-grid";
import {
  onboardingProfileSchema,
  type OnboardingProfileValues,
} from "@/lib/validators/onboarding";
import type { OnboardingProfileForm } from "@/stores/onboarding-flow";

export interface StepProfileProps {
  initialValues: OnboardingProfileForm;
  /** Caller registers this with the shell's primary CTA. The handler is
   *  re-bound on every render via a ref so the closure stays fresh. */
  bindSubmit: (handler: () => Promise<OnboardingProfileValues | null>) => void;
}

/**
 * Step 1 — basics. Captures DOB, address, contact phone, emergency
 * contact. Name + email are read-only on User and not editable here.
 */
export function StepProfile({ initialValues, bindSubmit }: StepProfileProps) {
  const form = useForm<OnboardingProfileValues>({
    resolver: zodResolver(onboardingProfileSchema),
    defaultValues: initialValues,
    mode: "onTouched",
  });

  // Register the validation+collect handler with the parent shell.
  // Re-binding on every render so the closure captures the freshest
  // form state — the parent only stores a thin pointer through which
  // it calls into the active step's submit.
  React.useEffect(() => {
    bindSubmit(async () => {
      const ok = await form.trigger();
      if (!ok) return null;
      return form.getValues();
    });
  }, [bindSubmit, form]);

  return (
    <Form {...form}>
      <form className="space-y-6">
        <FormGrid cols={2}>
          <FormField
            control={form.control}
            name="dateOfBirth"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Date of birth</FormLabel>
                <FormControl>
                  <Input type="date" {...field} autoComplete="bday" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Mobile phone</FormLabel>
                <FormControl>
                  <Input type="tel" placeholder="0412 345 678" {...field} autoComplete="tel" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormGridRow>
            <FormField
              control={form.control}
              name="addressLine1"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Street address</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="address-line1" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </FormGridRow>
          <FormGridRow>
            <FormField
              control={form.control}
              name="addressLine2"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Apartment / unit (optional)</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="address-line2" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </FormGridRow>
          <FormField
            control={form.control}
            name="suburb"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Suburb</FormLabel>
                <FormControl>
                  <Input {...field} autoComplete="address-level2" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="state"
            render={({ field }) => (
              <FormItem>
                <FormLabel>State</FormLabel>
                <FormControl>
                  <Input {...field} autoComplete="address-level1" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="postcode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Postcode</FormLabel>
                <FormControl>
                  <Input {...field} autoComplete="postal-code" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="country"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Country</FormLabel>
                <FormControl>
                  <Input {...field} autoComplete="country-name" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormGrid>

        <div className="space-y-4">
          <h2 className="h3">Emergency contact</h2>
          <FormGrid cols={2}>
            <FormField
              control={form.control}
              name="emergencyContactName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="emergencyContactPhone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl>
                    <Input type="tel" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormGridRow>
              <FormField
                control={form.control}
                name="emergencyContactRelationship"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Relationship to you</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Parent, Partner, Friend" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormGridRow>
          </FormGrid>
        </div>
      </form>
    </Form>
  );
}
