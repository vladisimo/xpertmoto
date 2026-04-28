/**
 * Per-provider email verification for OAuth sign-in.
 *
 * We refuse to auto-link an existing user (or mint a new one) unless the
 * provider has asserted the email is verified. Each provider emits this
 * differently:
 *
 *   Google       — `email_verified: true` (OIDC standard claim)
 *   Apple        — `email_verified: true | "true"` (always verified for real
 *                  addresses; Private Relay aliases are per-app random)
 *   Microsoft    — `xms_edov: true` (domain-owner-verified). The plain
 *                  `email` claim is NOT trustworthy per MS docs. Personal
 *                  MSA accounts often omit xms_edov — in that case we fall
 *                  through and make the user use magic-link instead.
 *   GitHub       — no claim on the id_token; we call /user/emails with the
 *                  access token and require the row where primary && verified
 *                  matches the provided email (case-insensitive).
 */

export interface GithubEmailEntry {
  email: string;
  primary: boolean;
  verified: boolean;
}

export type GithubEmailsFetcher = (accessToken: string) => Promise<GithubEmailEntry[]>;

interface VerifyArgs {
  provider: string | undefined;
  profile: Record<string, unknown> | undefined;
  accessToken: string | null | undefined;
  providerEmail: string;
  fetchGithubEmails?: GithubEmailsFetcher;
}

function claim(
  profile: Record<string, unknown> | undefined,
  key: string,
): unknown {
  return profile ? profile[key] : undefined;
}

export async function isOAuthEmailVerified(args: VerifyArgs): Promise<boolean> {
  const { provider, profile, accessToken, providerEmail, fetchGithubEmails } = args;
  switch (provider) {
    case "google":
      return claim(profile, "email_verified") === true;

    case "apple": {
      // Apple sends `email_verified` as either boolean or the string "true".
      const v = claim(profile, "email_verified");
      return v === true || v === "true";
    }

    case "microsoft-entra-id":
      // Only the domain-owner-verified claim is safe. Personal Microsoft
      // consumer accounts usually omit it; those users should use magic link.
      return claim(profile, "xms_edov") === true;

    case "github": {
      if (!accessToken || !fetchGithubEmails) return false;
      try {
        const rows = await fetchGithubEmails(accessToken);
        const target = providerEmail.trim().toLowerCase();
        return rows.some(
          (r) =>
            r.primary &&
            r.verified &&
            typeof r.email === "string" &&
            r.email.trim().toLowerCase() === target,
        );
      } catch {
        return false;
      }
    }

    default:
      // Unknown / future OAuth providers: refuse auto-link. They'd need
      // explicit handling here.
      return false;
  }
}

/**
 * Default GitHub emails fetcher. Kept as a plain function (not an instance
 * method) so tests can stub it out and no module state is shared.
 */
export const defaultGithubEmailsFetcher: GithubEmailsFetcher = async (
  accessToken,
) => {
  const res = await fetch("https://api.github.com/user/emails", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "scootering-auth",
    },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];
  return data.filter(
    (r): r is GithubEmailEntry =>
      typeof r === "object" &&
      r !== null &&
      typeof (r as GithubEmailEntry).email === "string" &&
      typeof (r as GithubEmailEntry).primary === "boolean" &&
      typeof (r as GithubEmailEntry).verified === "boolean",
  );
};
