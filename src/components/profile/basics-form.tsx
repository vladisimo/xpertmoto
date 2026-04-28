"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { FormGrid, FormGridRow } from "@/components/forms/form-grid";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc/client";

const schema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: z.string().trim().min(1, "Last name is required").max(100),
  phone: z
    .string()
    .trim()
    .max(40, "Phone number is too long")
    .regex(/^[\d+()\-\s]*$/u, "Phone may only contain digits, spaces, and + ( ) -")
    .optional()
    .or(z.literal("")),
});
type FormValues = z.infer<typeof schema>;

export function BasicsForm({
  initial,
  email,
}: {
  initial: { firstName: string; lastName: string; phone: string };
  email: string;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const update = trpc.profile.updateBasics.useMutation();
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: initial,
  });

  async function onSubmit(values: FormValues) {
    setError(null);
    setSaved(false);
    try {
      await update.mutateAsync({
        firstName: values.firstName,
        lastName: values.lastName,
        phone: values.phone ?? "",
      });
      await utils.profile.me.invalidate();
      form.reset(values);
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save changes");
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormGrid cols={2}>
          <FormField
            control={form.control}
            name="firstName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>First name</FormLabel>
                <FormControl>
                  <Input autoComplete="given-name" {...field} />
                </FormControl>
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
                <FormControl>
                  <Input autoComplete="family-name" {...field} />
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
                <FormLabel>Phone</FormLabel>
                <FormControl>
                  <Input
                    type="tel"
                    autoComplete="tel"
                    placeholder="0400 000 000"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="space-y-2">
            <Label htmlFor="profile-email">Email</Label>
            <Input id="profile-email" value={email} readOnly disabled />
            <p className="text-xs text-muted-foreground">
              Contact an admin to change your sign-in email.
            </p>
          </div>

          <FormGridRow className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              disabled={
                form.formState.isSubmitting || !form.formState.isDirty
              }
            >
              {form.formState.isSubmitting ? "Saving…" : "Save changes"}
            </Button>
            {saved && !form.formState.isDirty && (
              <span className="flex items-center gap-1.5 text-caption text-foreground">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                Saved
              </span>
            )}
            {error && <span className="text-caption text-destructive">{error}</span>}
          </FormGridRow>
        </FormGrid>
      </form>
    </Form>
  );
}
