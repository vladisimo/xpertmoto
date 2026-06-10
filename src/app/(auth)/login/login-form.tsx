"use client";
import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { loginInputSchema, type LoginInput } from "@/lib/validators/auth";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
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

function errorMessage(code: string | null): string | null {
  if (!code) return null;
  switch (code) {
    case "OAuthEmailUnverified":
      return "Your provider didn't confirm this email was verified. Try a magic link instead.";
    case "OAuthNoEmail":
      return "That account didn't share an email. Try a different sign-in method.";
    case "OAuthDisabledForBackOffice":
      return "Social sign-in is currently disabled for staff and admin accounts. Please use email and password instead.";
    case "AccountUnavailable":
      return "This account is unavailable. Contact support if you think this is an error.";
    case "OAuthAccountNotLinked":
      return "This sign-in method is already connected to another account. Please use a different sign-in method or contact support.";
    case "CredentialsSignin":
      return "Invalid credentials";
    case "EmailSignin":
      return "Couldn't send sign-in link — please try again or use a password.";
    default:
      return "Sign in failed. Please try again.";
  }
}

interface LoginFormProps {
  allProviders: OAuthProviderId[];
  enabledProviders: OAuthProviderId[];
  /**
   * Mirror of the `auth.oauthAllowedForBackOffice` SystemSetting. When
   * `false` we still render the OAuth buttons (customers always have
   * the option), but show an inline note so STAFF / ADMIN users don't
   * have to try and fail to learn the policy.
   */
  oauthAllowedForBackOffice: boolean;
}

export function LoginForm({
  allProviders,
  enabledProviders,
  oauthAllowedForBackOffice,
}: LoginFormProps) {
  const { siteName } = useBranding();
  const [error, setError] = useState<string | null>(null);
  const [sendingMagicLink, setSendingMagicLink] = useState(false);
  const [needTotp, setNeedTotp] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const urlError = new URLSearchParams(window.location.search).get("error");
    const friendly = errorMessage(urlError);
    if (friendly) setError(friendly);
  }, []);

  const preauth = trpc.auth.preauth.useMutation();

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginInputSchema),
    defaultValues: { email: "", password: "" },
  });

  function redirectPostLogin() {
    // `/portal-select` is the universal post-login landing — it inspects
    // role + hasCustomerProfile server-side and either renders the
    // multi-portal selector or redirects straight to the single dashboard
    // the user can access. callbackUrl deep-links are intentionally
    // dropped here for dual-access users; pure-role users still get
    // forwarded immediately so they never see the selector.
    window.location.href = "/portal-select";
  }

  async function onSubmit(values: LoginInput) {
    setError(null);
    setSubmitting(true);
    try {
      // If we're on the 2FA step, the password is already known-good —
      // jump straight to signIn with the code.
      if (needTotp) {
        const res = await signIn("credentials", {
          ...values,
          totpCode: totpCode.trim(),
          redirect: false,
        });
        if (res?.error) {
          setError("Invalid 2FA code");
          return;
        }
        redirectPostLogin();
        return;
      }

      // First step — check whether 2FA is required before calling signIn.
      const pre = await preauth.mutateAsync(values);
      if (pre.status === "bad_credentials") {
        setError("Invalid credentials");
        return;
      }
      if (pre.status === "need_totp") {
        setNeedTotp(true);
        return;
      }
      // No 2FA — complete sign-in as before.
      const res = await signIn("credentials", { ...values, redirect: false });
      if (res?.error) {
        setError("Invalid credentials");
        return;
      }
      redirectPostLogin();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function onMagicLink() {
    setError(null);
    const email = form.getValues("email");
    const parsed = loginInputSchema.shape.email.safeParse(email);
    if (!parsed.success) {
      form.setError("email", { message: "Enter a valid email" });
      return;
    }
    setSendingMagicLink(true);
    try {
      // H4: carry the deep-link the user was bounced from (e.g. a booking
      // page) into the emailed link, so clicking it lands them where they
      // were headed instead of /portal-select. Only same-origin relative
      // paths are honoured — anything else falls back to the default.
      const requested = new URLSearchParams(window.location.search).get(
        "callbackUrl",
      );
      const callbackUrl =
        requested && requested.startsWith("/") && !requested.startsWith("//")
          ? requested
          : "/portal-select";
      const res = await signIn("nodemailer", {
        email,
        redirect: false,
        callbackUrl,
      });
      if (res?.error) {
        setError(errorMessage("EmailSignin"));
        return;
      }
      const dest = new URLSearchParams({ email });
      window.location.href = `/magic-link-sent?${dest.toString()}`;
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSendingMagicLink(false);
    }
  }

  function onProviderUnavailable(id: OAuthProviderId) {
    setError(
      `Sign in with ${PROVIDER_DISPLAY[id]} isn't available on this deployment — try another method.`,
    );
  }

  return (
    <div className="w-full max-w-md space-y-8">
      <div className="space-y-6">
        <div className="md:hidden">
          <BrandLogo variant="mark" height={44} />
        </div>
        {needTotp && (
          <div className="space-y-2">
            <h1 className="h-display">Two-factor authentication</h1>
            <p className="body-text text-muted-foreground">
              Enter the 6-digit code from your authenticator app, or one of your recovery codes.
            </p>
          </div>
        )}
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

      {!needTotp && (
        <div className="space-y-4">
          <p className="eyebrow text-muted-foreground">Continue with</p>
          <OAuthButtons
            providers={allProviders}
            enabled={enabledProviders}
            disabled={submitting || sendingMagicLink}
            callbackUrl="/portal-select"
            onUnavailable={onProviderUnavailable}
          />
          {!oauthAllowedForBackOffice && (
            <p className="caption text-muted-foreground">
              Customers only — staff and admin accounts must sign in with
              email and password below.
            </p>
          )}
        </div>
      )}

      {!needTotp && (
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
                    readOnly={needTotp}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {!needTotp && (
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel>Password</FormLabel>
                    <Link
                      href="/forgot-password"
                      className="caption text-muted-foreground hover:text-foreground hover:underline"
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <FormControl>
                    <PasswordInput
                      autoComplete="current-password"
                      placeholder="Your password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
          {needTotp && (
            <div className="space-y-2">
              <Label htmlFor="totpCode" className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                Authenticator code
              </Label>
              <Input
                id="totpCode"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.slice(0, 24))}
                placeholder="123456 or xxxxx-xxxxx"
                autoComplete="one-time-code"
                inputMode="text"
                autoFocus
              />
              <p className="caption text-muted-foreground">
                Lost your device? Use one of the recovery codes you saved
                when setting up 2FA.
              </p>
            </div>
          )}
          <Button type="submit" className="w-full" size="lg" disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            {submitting
              ? needTotp
                ? "Verifying code…"
                : "Signing in…"
              : needTotp
                ? "Verify and sign in"
                : "Sign in"}
          </Button>
          {needTotp && (
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => {
                setNeedTotp(false);
                setTotpCode("");
                setError(null);
              }}
            >
              <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
              Back to sign in
            </Button>
          )}
          {!needTotp && (
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={onMagicLink}
              disabled={sendingMagicLink}
            >
              {sendingMagicLink && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              {sendingMagicLink ? "Sending link…" : "Email me a sign-in link instead"}
            </Button>
          )}
        </form>
      </Form>

      {!needTotp && (
        <p className="caption text-center text-muted-foreground">
          New to {siteName}?{" "}
          <Link href="/register" className="font-medium text-foreground hover:underline">
            Create an account
          </Link>
        </p>
      )}
    </div>
  );
}
