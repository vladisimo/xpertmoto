"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle, Loader2 } from "lucide-react";
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
import { OAuthButtons, type OAuthProviderId } from "@/components/auth/oauth-buttons";
import { PasswordInput } from "@/components/auth/password-input";
import { registerInputSchema } from "@/lib/validators/auth";

const KNOWN_OAUTH_PROVIDERS: readonly OAuthProviderId[] = [
  "google",
  "apple",
  "microsoft-entra-id",
  "github",
];

// Same widening as `register-form.tsx`: the server schema types the consent
// flags as `z.literal(true)` (so the server can't be tricked), but the form
// must start unchecked. Refine here, narrow at submit.
const registerFormSchema = registerInputSchema
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
type RegisterFormValues = z.infer<typeof registerFormSchema>;

const signInFormSchema = z.object({
  email: z.string().email("That doesn't look like a valid email."),
  password: z.string().min(1, "Enter your password."),
});
type SignInFormValues = z.infer<typeof signInFormSchema>;

export interface InlineAuthPanelProps {
  /** All advertised providers — hidden when none are configured. */
  allProviders: OAuthProviderId[];
  /** Providers with env vars set; OAuth round-trip is valid for these. */
  enabledProviders: OAuthProviderId[];
  /** Called after a successful credentials register / sign-in — lets the
   *  parent refresh its session query so the wizard advances past the
   *  auth gate. OAuth flows reload the page, so they bypass this. */
  onAuthenticated?: () => void;
}

/**
 * The Step 4 auth surface when the wizard_inline_auth flag is on. Drops
 * the old "leave /booking and bounce to /login or /register" fork in
 * favour of keeping the customer on the wizard.
 *
 * Two modes toggled by a tab-style switch: Create account (default) and
 * Sign in. OAuth row is shared and lives at the top of both. All
 * non-OAuth actions stay on /booking; OAuth round-trips with
 * callbackUrl=/booking so the provider drops them back here.
 */
export function InlineAuthPanel({
  allProviders,
  enabledProviders,
  onAuthenticated,
}: InlineAuthPanelProps) {
  const [mode, setMode] = useState<"register" | "signIn">("register");
  const [error, setError] = useState<string | null>(null);
  const [sendingMagicLink, setSendingMagicLink] = useState(false);
  const [magicLinkSentTo, setMagicLinkSentTo] = useState<string | null>(null);

  const register = trpc.auth.register.useMutation();

  const registerForm = useForm<RegisterFormValues>({
    resolver: zodResolver(registerFormSchema),
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

  const signInForm = useForm<SignInFormValues>({
    resolver: zodResolver(signInFormSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onRegisterSubmit(values: RegisterFormValues) {
    setError(null);
    try {
      await register.mutateAsync({
        ...values,
        acceptedTerms: true,
        acceptedPrivacy: true,
      });
      const res = await signIn("credentials", {
        email: values.email,
        password: values.password,
        redirect: false,
      });
      if (res?.error) {
        setError("Account created but sign-in failed — please sign in manually.");
        setMode("signIn");
        signInForm.setValue("email", values.email);
        return;
      }
      onAuthenticated?.();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not create account.";
      if (/already registered/i.test(message)) {
        setError(
          "That email is already registered. Switch to Sign in below to continue.",
        );
        setMode("signIn");
        signInForm.setValue("email", values.email);
        return;
      }
      setError(message);
    }
  }

  async function onSignInSubmit(values: SignInFormValues) {
    setError(null);
    const res = await signIn("credentials", {
      email: values.email,
      password: values.password,
      redirect: false,
    });
    if (res?.error) {
      setError("Couldn't sign you in — check your email and password.");
      return;
    }
    onAuthenticated?.();
  }

  async function onMagicLink(email: string) {
    setError(null);
    setSendingMagicLink(true);
    try {
      const res = await signIn("nodemailer", { email, redirect: false });
      if (res?.error) {
        setError("Couldn't send the sign-in link — please try again.");
        return;
      }
      setMagicLinkSentTo(email);
    } finally {
      setSendingMagicLink(false);
    }
  }

  const anyProviders = allProviders.length > 0;

  return (
    <div className="space-y-5">
      {error && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p className="caption">{error}</p>
        </div>
      )}

      {magicLinkSentTo && (
        <div className="rounded-md border border-primary/20 bg-primary/10 p-3 text-sm">
          We&apos;ve emailed a sign-in link to{" "}
          <span className="font-medium">{magicLinkSentTo}</span>. Open it on
          this device to continue the booking.
        </div>
      )}

      {anyProviders && (
        <div className="space-y-2">
          <p className="eyebrow text-muted-foreground">Quick sign-in with</p>
          <OAuthButtons
            providers={allProviders}
            enabled={enabledProviders}
            callbackUrl="/booking"
            disabled={register.isPending}
          />
        </div>
      )}

      {anyProviders && (
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
      )}

      <div
        role="tablist"
        aria-label="Authentication method"
        className="grid grid-cols-2 gap-1 rounded-md bg-muted/40 p-1"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === "register"}
          onClick={() => setMode("register")}
          className={
            "rounded-sm px-3 py-1.5 text-sm font-medium transition " +
            (mode === "register"
              ? "bg-background text-foreground shadow"
              : "text-muted-foreground hover:text-foreground")
          }
        >
          Create account
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "signIn"}
          onClick={() => setMode("signIn")}
          className={
            "rounded-sm px-3 py-1.5 text-sm font-medium transition " +
            (mode === "signIn"
              ? "bg-background text-foreground shadow"
              : "text-muted-foreground hover:text-foreground")
          }
        >
          Sign in
        </button>
      </div>

      {mode === "register" ? (
        <Form {...registerForm}>
          <form
            onSubmit={registerForm.handleSubmit(onRegisterSubmit)}
            className="space-y-3"
          >
            <FormField
              control={registerForm.control}
              name="firstName"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center gap-3">
                    <FormLabel className="w-24 shrink-0">First name</FormLabel>
                    <FormControl className="flex-1 min-w-0">
                      <Input autoComplete="given-name" {...field} />
                    </FormControl>
                  </div>
                  <FormMessage className="ml-[6.75rem]" />
                </FormItem>
              )}
            />
            <FormField
              control={registerForm.control}
              name="lastName"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center gap-3">
                    <FormLabel className="w-24 shrink-0">Last name</FormLabel>
                    <FormControl className="flex-1 min-w-0">
                      <Input autoComplete="family-name" {...field} />
                    </FormControl>
                  </div>
                  <FormMessage className="ml-[6.75rem]" />
                </FormItem>
              )}
            />
            <FormField
              control={registerForm.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center gap-3">
                    <FormLabel className="w-24 shrink-0">Email</FormLabel>
                    <FormControl className="flex-1 min-w-0">
                      <Input
                        type="email"
                        autoComplete="email"
                        placeholder="you@example.com"
                        {...field}
                      />
                    </FormControl>
                  </div>
                  <FormMessage className="ml-[6.75rem]" />
                </FormItem>
              )}
            />
            <FormField
              control={registerForm.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center gap-3">
                    <FormLabel className="w-24 shrink-0">Phone</FormLabel>
                    <FormControl className="flex-1 min-w-0">
                      <Input
                        type="tel"
                        autoComplete="tel"
                        placeholder="Optional"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                  </div>
                  <FormMessage className="ml-[6.75rem]" />
                </FormItem>
              )}
            />
            <FormField
              control={registerForm.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center gap-3">
                    <FormLabel className="w-24 shrink-0">Password</FormLabel>
                    <FormControl className="flex-1 min-w-0">
                      <PasswordInput
                        autoComplete="new-password"
                        placeholder="At least 10 characters"
                        {...field}
                      />
                    </FormControl>
                  </div>
                  <FormDescription className="ml-[6.75rem]">
                    Minimum 10 characters with upper, lower, number, and symbol.
                  </FormDescription>
                  <FormMessage className="ml-[6.75rem]" />
                </FormItem>
              )}
            />

            <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
              <FormField
                control={registerForm.control}
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
                control={registerForm.control}
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
                control={registerForm.control}
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
                        Email me about offers and updates (optional).
                      </span>
                    </label>
                  </FormItem>
                )}
              />
              <FormField
                control={registerForm.control}
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
              disabled={register.isPending || registerForm.formState.isSubmitting}
            >
              {register.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              {register.isPending ? "Creating account…" : "Create account & continue"}
            </Button>
          </form>
        </Form>
      ) : (
        <Form {...signInForm}>
          <form
            onSubmit={signInForm.handleSubmit(onSignInSubmit)}
            className="space-y-3"
          >
            <FormField
              control={signInForm.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center gap-3">
                    <FormLabel className="w-24 shrink-0">Email</FormLabel>
                    <FormControl className="flex-1 min-w-0">
                      <Input type="email" autoComplete="email" {...field} />
                    </FormControl>
                  </div>
                  <FormMessage className="ml-[6.75rem]" />
                </FormItem>
              )}
            />
            <FormField
              control={signInForm.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center gap-3">
                    <FormLabel className="w-24 shrink-0">Password</FormLabel>
                    <FormControl className="flex-1 min-w-0">
                      <PasswordInput autoComplete="current-password" {...field} />
                    </FormControl>
                  </div>
                  <FormMessage className="ml-[6.75rem]" />
                </FormItem>
              )}
            />
            <Button
              type="submit"
              className="w-full"
              disabled={signInForm.formState.isSubmitting}
            >
              {signInForm.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              Sign in & continue
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => {
                const email = signInForm.getValues("email");
                if (!email) {
                  setError("Enter your email first, then we'll send you a sign-in link.");
                  return;
                }
                void onMagicLink(email);
              }}
              disabled={sendingMagicLink}
            >
              {sendingMagicLink && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              Email me a sign-in link instead
            </Button>
          </form>
        </Form>
      )}
    </div>
  );
}

/**
 * Filter a provider list to the subset we know how to render. OAuth
 * providers may be added server-side; keep the UI strict about what
 * it'll draw a button for.
 */
export function filterKnownProviders(ids: string[]): OAuthProviderId[] {
  return ids.filter((p): p is OAuthProviderId =>
    (KNOWN_OAUTH_PROVIDERS as readonly string[]).includes(p),
  );
}
