"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { Github, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppleIcon, GoogleIcon, MicrosoftIcon } from "./provider-icons";

export type OAuthProviderId = "google" | "apple" | "microsoft-entra-id" | "github";
export type OAuthButtonsMode = "signIn" | "link";

const PROVIDER_LABELS: Record<OAuthProviderId, string> = {
  google: "Google",
  apple: "Apple",
  "microsoft-entra-id": "Microsoft",
  github: "GitHub",
};

function ProviderIcon({ id }: { id: OAuthProviderId }) {
  const className = "h-5 w-5";
  switch (id) {
    case "google":
      return <GoogleIcon className={className} />;
    case "github":
      return <Github className={className} aria-hidden />;
    case "apple":
      return <AppleIcon className={className} />;
    case "microsoft-entra-id":
      return <MicrosoftIcon className={className} />;
  }
}

export interface OAuthButtonsProps {
  /** Providers to render. Login passes the full canonical list so every
   *  option is advertised regardless of deployment config. */
  providers: OAuthProviderId[];
  /** Subset of `providers` actually wired in env. When omitted every rendered
   *  provider is treated as wired (legacy behaviour, used by Register + the
   *  Connected Accounts linking UI which filters upstream). When provided,
   *  clicks on an unwired provider call `onUnavailable` and skip `signIn` so
   *  NextAuth doesn't blow up on an unknown provider. */
  enabled?: OAuthProviderId[];
  /** `signIn` (default) uses the standard callback; `link` is used by the
   *  Connected Accounts UI when the caller is already authenticated and
   *  wants to attach a new provider to their existing user. */
  mode?: OAuthButtonsMode;
  /** Prefill the provider's login_hint when known (e.g. from a registration
   *  conflict). Supported by Google and Microsoft. */
  email?: string;
  /** Where NextAuth should drop the user after the round-trip. Defaults to
   *  undefined (NextAuth's role-aware post-login fallback). */
  callbackUrl?: string;
  /** Disable all buttons (e.g. while a parent form is submitting). */
  disabled?: boolean;
  /** Invoked when a user clicks a provider that's in `providers` but not in
   *  `enabled`. Parent typically shows an inline message. */
  onUnavailable?: (id: OAuthProviderId) => void;
}

export function OAuthButtons({
  providers,
  enabled,
  mode = "signIn",
  email,
  callbackUrl,
  disabled,
  onUnavailable,
}: OAuthButtonsProps) {
  const [busy, setBusy] = useState<OAuthProviderId | null>(null);

  if (providers.length === 0) return null;

  async function onClick(id: OAuthProviderId) {
    if (enabled && !enabled.includes(id)) {
      onUnavailable?.(id);
      return;
    }
    setBusy(id);
    try {
      // `redirect: false` + manual navigate, not `redirect: true`. When
      // NextAuth redirects internally it may fire `window.location.href`
      // before the browser has fully committed the `Set-Cookie` from the
      // signin POST response to the cookie jar — desktop serializes these,
      // mobile Chrome under memory/network pressure does not. A half-stored
      // pkce cookie resurfaces on the callback as
      // `InvalidCheck: pkceCodeVerifier value could not be parsed`.
      const res = await signIn(id, {
        redirect: false,
        callbackUrl,
        ...(email ? { login_hint: email } : {}),
      });
      if (res?.url) {
        window.location.href = res.url;
      } else if (res?.error) {
        // Surface the error via the hash-less URL NextAuth renders. Falls
        // back to the existing /login?error=... rendering path.
        window.location.href = `/login?error=${encodeURIComponent(res.error)}`;
      }
    } finally {
      setBusy(null);
    }
  }

  const labelPrefix = mode === "link" ? "Connect" : "Continue with";

  return (
    <div className="grid grid-cols-4 gap-2">
      {providers.map((id) => (
        <Button
          key={id}
          type="button"
          variant="secondary"
          className="h-11 w-full px-0"
          onClick={() => onClick(id)}
          disabled={disabled || busy !== null}
          aria-label={`${labelPrefix} ${PROVIDER_LABELS[id]}`}
          title={PROVIDER_LABELS[id]}
        >
          {busy === id ? (
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          ) : (
            <ProviderIcon id={id} />
          )}
        </Button>
      ))}
    </div>
  );
}
