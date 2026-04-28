"use client";

import { useFormContext, useWatch, type Control } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormGrid, FormGridRow } from "@/components/forms/form-grid";
import { AU_STATES, type WizardFormValues } from "./wizard-types";

// Tiny re-export so the unused-var linter knows <Form> only appears in the
// container. `control` is enough here because we're nested inside it.
void Form;

export function StepDetails() {
  const form = useFormContext<WizardFormValues>();
  const isInternational = useWatch({ control: form.control, name: "isInternational" });

  return (
    <div className="space-y-6">
      <ContactCard control={form.control} />
      <AddressCard control={form.control} isInternational={!!isInternational} />
      {!isInternational && <LicenceCard control={form.control} />}
      <PassportCard control={form.control} isInternational={!!isInternational} />
    </div>
  );
}

function ContactCard({ control }: { control: Control<WizardFormValues> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Contact</CardTitle>
      </CardHeader>
      <CardContent>
        <FormGrid cols={2}>
          <FormField
            control={control}
            name="firstName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>First name</FormLabel>
                <FormControl>
                  <Input autoFocus {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name="lastName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Last name</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input type="email" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Phone</FormLabel>
                <FormControl>
                  <Input type="tel" placeholder="04xx xxx xxx" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name="dateOfBirth"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Date of birth</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormGrid>
      </CardContent>
    </Card>
  );
}

function AddressCard({
  control,
  isInternational,
}: {
  control: Control<WizardFormValues>;
  isInternational: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Residential address
          {isInternational && (
            <span className="ml-2 text-caption font-normal text-muted-foreground">
              — passports don&apos;t carry an address. Please fill this in manually.
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <FormGrid cols={2}>
          <FormGridRow>
            <FormField
              control={control}
              name="addressLine1"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Address line 1</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </FormGridRow>
          <FormGridRow>
            <FormField
              control={control}
              name="addressLine2"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Address line 2</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </FormGridRow>
          <FormField
            control={control}
            name="suburb"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Suburb</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name="state"
            render={({ field }) => (
              <FormItem>
                <FormLabel>State / region</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name="postcode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Postcode</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name="country"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Country</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormGrid>
      </CardContent>
    </Card>
  );
}

function LicenceCard({ control }: { control: Control<WizardFormValues> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Driver licence</CardTitle>
      </CardHeader>
      <CardContent>
        <FormGrid cols={2}>
          <FormField
            control={control}
            name="licenceNumber"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Licence number</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name="licenceState"
            render={({ field }) => (
              <FormItem>
                <FormLabel>State</FormLabel>
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
          <FormField
            control={control}
            name="licenceClass"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Class</FormLabel>
                <FormControl>
                  <Input placeholder="e.g. C, RE, R" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name="licenceExpiry"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Expiry</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormGrid>
      </CardContent>
    </Card>
  );
}

function PassportCard({
  control,
  isInternational,
}: {
  control: Control<WizardFormValues>;
  isInternational: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Passport{" "}
          <span className="ml-1 text-caption text-muted-foreground">
            {isInternational ? "(required)" : "(optional — for identity verification)"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <FormGrid cols={2}>
          <FormField
            control={control}
            name="passportNumber"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Passport number</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name="passportCountry"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Issuing country</FormLabel>
                <FormControl>
                  <Input placeholder="e.g. Australia, United Kingdom" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name="passportExpiry"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Expiry</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormGrid>
      </CardContent>
    </Card>
  );
}
