"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
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
import { registerInputSchema } from "@/lib/validators/auth";
import { BrandLogo } from "@/components/shared/brand-logo";
import { useBranding } from "@/components/shared/branding-provider";
import { OAuthButtons, type OAuthProviderId } from "@/components/auth/oauth-buttons";
import { PasswordInput } from "@/components/auth/password-input";

const PROVIDER_DISPLAY: Record<OAuthProviderId, string> = {
  google: "Google",
  apple: "Apple",
  "microsoft-entra-id": "Microsoft",
  github: "GitHub",
};

const KNOWN_OAUTH_PROVIDERS: readonly OAuthProviderId[] = [
  "google",
  "apple",
  "microsoft-entra-id",
  "github",
];

// `registerInputSchema` types `acceptedTerms` / `acceptedPrivacy` as
// `z.literal(true)`, which would force the form's `defaultValues` to be `true`
// before the user has interacted. Override here with `z.boolean().refine(...)`
// so the form starts unchecked and Zod still hard-fails submit if untouched.
// The submit handler narrows the values back to literal `true` before sending
// to the server schema.
const formSchema = registerInputSchema
  .pick({
    firstName: true,
    lastName: true,
    email: true,
    password: true,
    phone: true,
    marketingOptIn: true,
    marketingSmsOptIn: true,
  })
  .extend({
    phone: z.string().optional(),
    acceptedTerms: z
      .boolean()
      .refine((v) => v === true, { message: "You must accept the Terms & Conditions" }),
    acceptedPrivacy: z
      .boolean()
      .refine((v) => v === true, { message: "You must accept the Privacy Policy" }),
  });
type FormValues = z.infer<typeof formSchema>;

interface RegisterFormProps {
  allProviders: OAuthProviderId[];
  enabledProviders: OAuthProviderId[];
}

interface ConflictState {
  email: string;
  hasPassword: boolean;
  oauthProviders: OAuthProviderId[];
}

export function RegisterForm({ allProviders, enabledProviders }: RegisterFormProps) {
  const { siteName } = useBranding();
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [sendingMagicLink, setSendingMagicLink] = useState(false);
  const register = trpc.auth.register.useMutation();
  const hintUtil = trpc.useUtils();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      password: "",
      acceptedTerms: false,
      acceptedPrivacy: false,
      marketingOptIn: false,
      marketingSmsOptIn: false,
    },
  });

  async function onSubmit(values: FormValues) {
    setError(null);
    setConflict(null);
    try {
      // Zod refine has already enforced both flags === true; cast to the
      // literal shape the server schema expects.
      await register.mutateAsync({
        ...values,
        acceptedTerms: true,
        acceptedPrivacy: true,
      });
      await signIn("credentials", { email: values.email, password: values.password, redirect: false });
      // Straight to the onboarding wizard — the customer layout would
      // redirect there anyway (profile gate); skipping the /dashboard hop
      // avoids a jarring double redirect on first sign-in.
      window.location.href = "/onboarding?next=/dashboard";
    } catch (e) {
      const message = e instanceof Error ? e.message : "Registration failed";
      // CONFLICT surfaces from tRPC with the message "Email already registered"
      // — rather than just showing an error, reveal the OAuth + magic-link
      // CTAs so the user can continue in one click.
      if (/already registered/i.test(message)) {
        try {
          const hint = await hintUtil.auth.existingAccountHint.fetch({
            email: values.email,
          });
          const oauthProviders = hint.methods.filter((m): m is OAuthProviderId =>
            (KNOWN_OAUTH_PROVIDERS as readonly string[]).includes(m),
          );
          setConflict({
            email: values.email,
            hasPassword: hint.methods.includes("password"),
            oauthProviders,
          });
          return;
        } catch {
          // Hint endpoint rate-limited or otherwise unavailable — fall back
          // to the generic conflict message below.
        }
      }
      setError(message);
    }
  }

  async function onMagicLink(email: string) {
    setError(null);
    setSendingMagicLink(true);
    try {
      const res = await signIn("nodemailer", { email, redirect: false });
      if (res?.error) {
        setError("Couldn't send sign-in link — please try again.");
        return;
      }
      const dest = new URLSearchParams({ email });
      window.location.href = `/magic-link-sent?${dest.toString()}`;
    } finally {
      setSendingMagicLink(false);
    }
  }

  function onProviderUnavailable(id: OAuthProviderId) {
    setError(
      `Sign in with ${PROVIDER_DISPLAY[id]} isn't available on this deployment — try another method.`,
    );
  }

  if (conflict) {
    const actionableProviders = conflict.oauthProviders.filter((p) =>
      enabledProviders.includes(p),
    );
    return (
      <div className="w-full max-w-md space-y-8">
        <div className="md:hidden">
          <BrandLogo variant="mark" height={44} />
        </div>
        <div className="space-y-2">
          <h1 className="h-display">You already have an account</h1>
          <p className="body-text text-muted-foreground">
            We found an existing account for{" "}
            <span className="font-medium text-foreground">{conflict.email}</span>.
            Continue below to sign in.
          </p>
        </div>
        <div className="space-y-4">
          {actionableProviders.length > 0 && (
            <>
              <p className="eyebrow text-muted-foreground">Continue with</p>
              <OAuthButtons
                providers={actionableProviders}
                email={conflict.email}
                disabled={sendingMagicLink}
              />
            </>
          )}
          {conflict.hasPassword && (
            <Button asChild variant="secondary" className="w-full" size="lg">
              <Link href={`/login?email=${encodeURIComponent(conflict.email)}`}>
                Sign in with password
              </Link>
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            size="lg"
            onClick={() => onMagicLink(conflict.email)}
            disabled={sendingMagicLink}
          >
            {sendingMagicLink && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            {sendingMagicLink ? "Sending link…" : "Email me a sign-in link"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => {
              setConflict(null);
              form.setValue("email", "");
            }}
          >
            <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
            Use a different email
          </Button>
        </div>
        <p className="caption text-center text-muted-foreground">
          <Link href="/login" className="font-medium text-foreground hover:underline">
            Back to sign in
          </Link>
        </p>
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
          <h1 className="h-display">Create your account</h1>
          <p className="body-text text-muted-foreground">
            Join {siteName} to book a ride in under a minute.
          </p>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p className="caption">{error}</p>
        </div>
      )}

      <div className="space-y-4">
        <p className="eyebrow text-muted-foreground">Continue with</p>
        <OAuthButtons
          providers={allProviders}
          enabled={enabledProviders}
          disabled={register.isPending || form.formState.isSubmitting}
          onUnavailable={onProviderUnavailable}
        />
      </div>

      <div className="relative">
        <div className="absolute inset-0 flex items-center" aria-hidden>
          <span className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center">
          <span className="eyebrow bg-background px-3 text-muted-foreground">
            or use your email
          </span>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
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
          </div>
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
                    placeholder="Optional"
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <PasswordInput
                    autoComplete="new-password"
                    placeholder="At least 10 characters"
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  Minimum 10 characters with upper, lower, number, and symbol.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4">
            <FormField
              control={form.control}
              name="acceptedTerms"
              render={({ field }) => (
                <FormItem>
                  <label className="flex items-start gap-3 text-sm">
                    <FormControl>
                      <input
                        type="checkbox"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        name={field.name}
                        className="mt-1 h-4 w-4"
                      />
                    </FormControl>
                    <span>
                      I agree to the{" "}
                      <Link href="/terms" target="_blank" className="text-primary underline">
                        Terms &amp; Conditions
                      </Link>
                      .
                    </span>
                  </label>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="acceptedPrivacy"
              render={({ field }) => (
                <FormItem>
                  <label className="flex items-start gap-3 text-sm">
                    <FormControl>
                      <input
                        type="checkbox"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        name={field.name}
                        className="mt-1 h-4 w-4"
                      />
                    </FormControl>
                    <span>
                      I have read the{" "}
                      <Link href="/privacy" target="_blank" className="text-primary underline">
                        Privacy Policy
                      </Link>
                      .
                    </span>
                  </label>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="marketingOptIn"
              render={({ field }) => (
                <FormItem>
                  <label className="flex items-start gap-3 text-sm">
                    <FormControl>
                      <input
                        type="checkbox"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        name={field.name}
                        className="mt-1 h-4 w-4"
                      />
                    </FormControl>
                    <span className="text-muted-foreground">
                      Email me about offers and product updates (optional).
                    </span>
                  </label>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="marketingSmsOptIn"
              render={({ field }) => (
                <FormItem>
                  <label className="flex items-start gap-3 text-sm">
                    <FormControl>
                      <input
                        type="checkbox"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        name={field.name}
                        className="mt-1 h-4 w-4"
                      />
                    </FormControl>
                    <span className="text-muted-foreground">
                      Send me SMS reminders and promotions (optional).
                    </span>
                  </label>
                </FormItem>
              )}
            />
          </div>

          <Button
            type="submit"
            className="w-full"
            size="lg"
            disabled={register.isPending || form.formState.isSubmitting}
          >
            {register.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            )}
            {register.isPending ? "Creating account…" : "Create account"}
          </Button>
        </form>
      </Form>

      <p className="caption text-center text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-foreground hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
