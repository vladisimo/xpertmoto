"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { trpc } from "@/lib/trpc/client";
import { strongPasswordField } from "@/lib/validators/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BrandLogo } from "@/components/shared/brand-logo";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

const acceptInviteSchema = z.object({
  token: z.string().min(10),
  password: strongPasswordField,
});
type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

function AcceptInviteForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const preview = trpc.invite.preview.useQuery(
    { token },
    { enabled: token.length > 0, retry: false },
  );
  const accept = trpc.invite.accept.useMutation();
  const [error, setError] = useState<string | null>(null);

  const form = useForm<AcceptInviteInput>({
    resolver: zodResolver(acceptInviteSchema),
    defaultValues: { token, password: "" },
  });

  async function onSubmit(values: AcceptInviteInput) {
    setError(null);
    try {
      const res = await accept.mutateAsync(values);
      // Sign the user in with the password they just set, then route based
      // on whether 2FA enrolment is required.
      const signInRes = await signIn("credentials", {
        email: res.email,
        password: values.password,
        redirect: false,
      });
      if (signInRes?.error) {
        // Rare: acceptance succeeded but auto-sign-in failed. Send them to
        // the login page to try manually.
        router.push("/login");
        return;
      }
      if (res.requiresTotp) {
        router.push("/totp/enroll");
      } else {
        router.push("/dashboard");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to accept invitation");
    }
  }

  if (!token) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Link not valid</CardTitle>
          <CardDescription>
            This invitation link is missing its token. Ask your administrator
            to resend the invitation.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild variant="secondary" className="w-full">
            <Link href="/login">Go to sign in</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (preview.isLoading) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Checking invitation…</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  if (preview.data && !preview.data.valid) {
    const msg =
      preview.data.reason === "already_activated"
        ? "This invitation has already been used. Try signing in instead."
        : "This invitation link is invalid or has expired. Ask your administrator to resend it.";
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Invitation unavailable</CardTitle>
          <CardDescription>{msg}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild variant="secondary" className="w-full">
            <Link href="/login">Go to sign in</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  const displayName =
    preview.data && preview.data.valid
      ? [preview.data.firstName, preview.data.lastName].filter(Boolean).join(" ")
      : "";

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Accept your invitation</CardTitle>
        <CardDescription>
          {displayName ? `Welcome ${displayName}. ` : ""}
          Choose a password to activate your account.
          {preview.data && preview.data.valid ? (
            <>
              {" "}Signing in as{" "}
              <strong className="text-foreground">{preview.data.email}</strong>.
            </>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    At least 10 characters with upper-, lower-, digit, and a
                    symbol.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              type="submit"
              className="w-full"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? "Activating…" : "Activate account"}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

export default function AcceptInvitePage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-4">
      <BrandLogo height={36} />
      <Suspense fallback={null}>
        <AcceptInviteForm />
      </Suspense>
    </div>
  );
}
