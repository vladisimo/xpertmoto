"use client";
import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Loader2, MailCheck } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import {
  forgotPasswordInputSchema,
  type ForgotPasswordInput,
} from "@/lib/validators/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { BrandLogo } from "@/components/shared/brand-logo";

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const request = trpc.auth.requestPasswordReset.useMutation();

  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordInputSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit(values: ForgotPasswordInput) {
    await request.mutateAsync(values);
    setSent(true);
  }

  if (sent) {
    const email = form.getValues("email");
    return (
      <div className="w-full max-w-md space-y-8">
        <div className="md:hidden">
          <BrandLogo variant="mark" height={44} />
        </div>
        <div className="flex items-start gap-3 rounded-md border border-border bg-muted/40 p-4">
          <MailCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-foreground"
            aria-hidden
          />
          <div className="space-y-1">
            <p className="body-text font-medium text-foreground">Check your inbox</p>
            <p className="caption text-muted-foreground">
              If an account exists for{" "}
              <span className="font-medium text-foreground">{email}</span>, we've
              sent a link to reset your password. The link expires in 30 minutes.
              Check your spam folder if you don't see it.
            </p>
          </div>
        </div>
        <div className="space-y-3">
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            size="lg"
            onClick={() => {
              setSent(false);
              form.reset({ email: "" });
            }}
          >
            Try another email
          </Button>
          <Button asChild variant="ghost" className="w-full">
            <Link href="/login">
              <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
              Back to sign in
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md space-y-8">
      <div className="space-y-6">
        <div className="md:hidden">
          <BrandLogo variant="mark" height={44} />
        </div>
        <div className="space-y-2">
          <h1 className="h-display">Forgot your password?</h1>
          <p className="body-text text-muted-foreground">
            Enter your email and we'll send you a link to set a new password.
          </p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button
            type="submit"
            className="w-full"
            size="lg"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            )}
            {form.formState.isSubmitting ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      </Form>

      <p className="caption text-center text-muted-foreground">
        Remembered it?{" "}
        <Link href="/login" className="font-medium text-foreground hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
