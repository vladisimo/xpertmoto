/**
 * Post-login destination resolution for the auth screens.
 *
 * The `?callbackUrl=` param is written by the middleware bounce
 * (src/proxy.ts), the global tRPC 401 handler and the booking wizard's
 * "Sign in" links -- but it reaches us through the URL, so it is
 * attacker-controllable and must never be used as a bare redirect target
 * (open redirect / credential-phishing hand-off).
 */

/**
 * Tab / LF / CR are stripped from a URL by the browser *before* it is
 * resolved, so a value like "/\t/evil.com" normalises back to the
 * protocol-relative "//evil.com". Reject anything carrying one rather than
 * trying to sanitise it.
 */
const URL_STRIPPED_CHARS = /[\t\n\r]/;

/**
 * Returns `requested` when it is a safe same-origin destination, otherwise
 * `fallback`. Safe means: a single leading `/` and nothing a browser could
 * normalise into an authority ("//host", "/\host"). Schemes ("https:",
 * "javascript:") and bare hosts never start with `/`, so the leading-slash
 * rule already excludes them.
 */
export function resolveCallbackUrl(
  requested: string | null | undefined,
  fallback: string,
): string {
  if (typeof requested !== "string") return fallback;
  if (!requested.startsWith("/")) return fallback;
  if (requested.startsWith("//") || requested.startsWith("/\\")) return fallback;
  if (URL_STRIPPED_CHARS.test(requested)) return fallback;
  return requested;
}
