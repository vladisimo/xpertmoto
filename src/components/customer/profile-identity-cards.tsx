"use client";

/**
 * Client island for /dashboard/profile. Renders three IdentityUploadCard
 * instances (licence front, licence back, passport) and an "Edit details"
 * form that covers the identity text fields + contact info.
 */

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { AU_STATES } from "@/lib/validators/identity";
import { trpc } from "@/lib/trpc/client";

interface Props {
  initial: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    dateOfBirth: string | null;
    licenceNumber: string | null;
    licenceState: string | null;
    licenceExpiry: string | null;
    licenceClass: string | null;
    passportNumber: string | null;
    passportCountry: string | null;
    passportExpiry: string | null;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
    companyName: string | null;
    abn: string | null;
  };
}

const formSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().optional(),
  dateOfBirth: z.string().optional(),
  licenceNumber: z.string().optional(),
  licenceState: z.string().optional(),
  licenceExpiry: z.string().optional(),
  licenceClass: z.string().optional(),
  passportNumber: z.string().optional(),
  passportCountry: z.string().optional(),
  passportExpiry: z.string().optional(),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  companyName: z.string().max(120).optional(),
  abn: z
    .string()
    .optional()
    .refine(
      (v) => !v || /^\d{11}$/.test(v.replace(/\D/g, "")),
      "ABN must be 11 digits.",
    ),
});
type FormValues = z.infer<typeof formSchema>;

function toDateInput(raw: string | null): string {
  if (!raw) return "";
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

export function ProfileIdentityCards({ initial }: Props) {
  const [editing, setEditing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const util = trpc.useUtils();
  const updateProfile = trpc.customer.updateProfile.useMutation();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      firstName: initial.firstName,
      lastName: initial.lastName,
      phone: initial.phone ?? "",
      dateOfBirth: toDateInput(initial.dateOfBirth),
      licenceNumber: initial.licenceNumber ?? "",
      licenceState: initial.licenceNumber ? initial.licenceState ?? "" : "",
      licenceExpiry: toDateInput(initial.licenceExpiry),
      licenceClass: initial.licenceClass ?? "",
      passportNumber: initial.passportNumber ?? "",
      passportCountry: initial.passportCountry ?? "",
      passportExpiry: toDateInput(initial.passportExpiry),
      emergencyContactName: initial.emergencyContactName ?? "",
      emergencyContactPhone: initial.emergencyContactPhone ?? "",
      companyName: initial.companyName ?? "",
      abn: initial.abn ?? "",
    },
  });

  async function onSubmit(values: FormValues) {
    setSaveError(null);
    try {
      await updateProfile.mutateAsync({
        firstName: values.firstName,
        lastName: values.lastName,
        phone: values.phone,
        dateOfBirth: values.dateOfBirth || undefined,
        licenceNumber: values.licenceNumber,
        licenceState: values.licenceState
          ? (values.licenceState as (typeof AU_STATES)[number])
          : undefined,
        licenceExpiry: values.licenceExpiry || undefined,
        licenceClass: values.licenceClass,
        passportNumber: values.passportNumber,
        passportCountry: values.passportCountry,
        passportExpiry: values.passportExpiry || undefined,
        emergencyContactName: values.emergencyContactName,
        emergencyContactPhone: values.emergencyContactPhone,
        companyName: values.companyName || undefined,
        abn: values.abn || undefined,
      });
      await util.customer.me.invalidate();
      setEditing(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not save your details.");
    }
  }

  return (
    <div className="space-y-6">
      {/* Editable text fields */}
      <Card>
        <CardHeader>
          <CardTitle className="h3 flex items-center justify-between">
            <span>Details</span>
            {!editing ? (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                Edit details
              </Button>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!editing ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Name</dt>
              <dd>{initial.firstName} {initial.lastName}</dd>
              <dt className="text-muted-foreground">Email</dt>
              <dd>{initial.email}</dd>
              <dt className="text-muted-foreground">Phone</dt>
              <dd>{initial.phone ?? "—"}</dd>
              <dt className="text-muted-foreground">Date of birth</dt>
              <dd>{initial.dateOfBirth ? new Date(initial.dateOfBirth).toLocaleDateString("en-AU") : "—"}</dd>
              <dt className="text-muted-foreground">Licence number</dt>
              <dd>{initial.licenceNumber ?? "—"}</dd>
              <dt className="text-muted-foreground">Licence state</dt>
              <dd>{initial.licenceNumber && initial.licenceState ? initial.licenceState : "—"}</dd>
              <dt className="text-muted-foreground">Licence expiry</dt>
              <dd>{initial.licenceExpiry ? new Date(initial.licenceExpiry).toLocaleDateString("en-AU") : "—"}</dd>
              <dt className="text-muted-foreground">Licence class</dt>
              <dd>{initial.licenceClass ?? "—"}</dd>
              <dt className="text-muted-foreground">Passport number</dt>
              <dd>{initial.passportNumber ?? "—"}</dd>
              <dt className="text-muted-foreground">Passport country</dt>
              <dd>{initial.passportCountry ?? "—"}</dd>
              <dt className="text-muted-foreground">Passport expiry</dt>
              <dd>{initial.passportExpiry ? new Date(initial.passportExpiry).toLocaleDateString("en-AU") : "—"}</dd>
              <dt className="text-muted-foreground">Emergency contact</dt>
              <dd>
                {initial.emergencyContactName ?? "—"}
                {initial.emergencyContactPhone ? ` · ${initial.emergencyContactPhone}` : ""}
              </dd>
              <dt className="text-muted-foreground">Company name</dt>
              <dd>{initial.companyName ?? "—"}</dd>
              <dt className="text-muted-foreground">ABN</dt>
              <dd>
                {initial.abn
                  ? initial.abn.replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3 $4")
                  : "—"}
              </dd>
            </dl>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="firstName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>First name</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="lastName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Last name</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone</FormLabel>
                        <FormControl><Input type="tel" {...field} value={field.value ?? ""} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="dateOfBirth"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Date of birth</FormLabel>
                        <FormControl><Input type="date" {...field} value={field.value ?? ""} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="md:col-span-2">
                    <h4 className="text-sm font-semibold text-muted-foreground">Driver&apos;s licence</h4>
                  </div>
                  <FormField
                    control={form.control}
                    name="licenceNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Licence number</FormLabel>
                        <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="licenceState"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Licence state</FormLabel>
                        <Select
                          value={field.value ?? ""}
                          onValueChange={(v) => field.onChange(v === "__none__" ? "" : v)}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="—" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="__none__">—</SelectItem>
                            {AU_STATES.map((s) => (
                              <SelectItem key={s} value={s}>{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="licenceExpiry"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Licence expiry</FormLabel>
                        <FormControl><Input type="date" {...field} value={field.value ?? ""} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="licenceClass"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Licence class</FormLabel>
                        <FormControl><Input {...field} value={field.value ?? ""} placeholder="e.g. C, RE, R" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="md:col-span-2">
                    <h4 className="text-sm font-semibold text-muted-foreground">Passport</h4>
                  </div>
                  <FormField
                    control={form.control}
                    name="passportNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Passport number</FormLabel>
                        <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="passportCountry"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Country</FormLabel>
                        <FormControl><Input {...field} value={field.value ?? ""} placeholder="AU" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="passportExpiry"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Passport expiry</FormLabel>
                        <FormControl><Input type="date" {...field} value={field.value ?? ""} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="md:col-span-2">
                    <h4 className="text-sm font-semibold text-muted-foreground">Emergency contact</h4>
                  </div>
                  <FormField
                    control={form.control}
                    name="emergencyContactName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name</FormLabel>
                        <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
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
                        <FormControl><Input type="tel" {...field} value={field.value ?? ""} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="md:col-span-2">
                    <h4 className="text-sm font-semibold text-muted-foreground">
                      Business details
                      <span className="ml-2 caption font-normal">
                        Optional — for tax invoices issued to a business.
                      </span>
                    </h4>
                  </div>
                  <FormField
                    control={form.control}
                    name="companyName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Company name</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ""} placeholder="Acme Pty Ltd" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="abn"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>ABN</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            value={field.value ?? ""}
                            placeholder="11 digit ABN"
                            inputMode="numeric"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {saveError && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                    {saveError}
                  </div>
                )}

                <div className="flex gap-2">
                  <Button type="submit" disabled={updateProfile.isPending}>
                    {updateProfile.isPending ? "Saving…" : "Save"}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            </Form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
