"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { trpc } from "@/lib/trpc/client";
import {
  setPasswordInputSchema,
  type SetPasswordInput,
} from "@/lib/validators/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

export function SetPasswordForm() {
  const router = useRouter();
  const setPassword = trpc.auth.setPassword.useMutation();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const form = useForm<SetPasswordInput>({
    resolver: zodResolver(setPasswordInputSchema),
    defaultValues: { password: "" },
  });

  async function onSubmit(values: SetPasswordInput) {
    setError(null);
    try {
      await setPassword.mutateAsync(values);
      setDone(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save password");
    }
  }

  if (done) {
    return (
      <p className="text-sm text-foreground">
        Password saved. You can now sign in with your email and this password.
      </p>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>New password</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormDescription>
                At least 10 characters. Choose something you don&apos;t use
                elsewhere.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Saving…" : "Save password"}
        </Button>
      </form>
    </Form>
  );
}
