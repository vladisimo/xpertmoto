import { SignJWT, importPKCS8 } from "jose";

/**
 * Apple Sign In requires the OAuth `client_secret` to be a short-lived JWT
 * signed with your Apple Developer `.p8` private key (ES256). NextAuth does
 * NOT sign this for you — we have to build it ourselves and pass the string
 * into the `clientSecret` field of the provider config.
 *
 * Apple caps the lifetime at 6 months. We cache the generated token in-memory
 * and regenerate 7 days before expiry. On process restart the cache is
 * cleared — acceptable, it takes milliseconds to rebuild.
 *
 * Env vars (all required for Apple to be enabled in auth.ts):
 *   AUTH_APPLE_ID          — the Services ID (e.g. `com.scootering.web`)
 *   AUTH_APPLE_TEAM_ID     — your 10-char Apple Team ID
 *   AUTH_APPLE_KEY_ID      — the Key ID for the .p8
 *   AUTH_APPLE_PRIVATE_KEY — the .p8 PEM contents. Escape newlines as \n
 *                            in the env var; we replace them on load.
 */

const MAX_TTL_SECONDS = 6 * 30 * 24 * 60 * 60; // ~6 months
const EARLY_REFRESH_SECONDS = 7 * 24 * 60 * 60; // 7 days

interface Cached {
  token: string;
  expiresAt: number;
}

let cache: Cached | null = null;

function readEnv() {
  const clientId = process.env.AUTH_APPLE_ID;
  const teamId = process.env.AUTH_APPLE_TEAM_ID;
  const keyId = process.env.AUTH_APPLE_KEY_ID;
  const privateKey = process.env.AUTH_APPLE_PRIVATE_KEY;
  if (!clientId || !teamId || !keyId || !privateKey) {
    throw new Error(
      "Apple OAuth: AUTH_APPLE_ID, AUTH_APPLE_TEAM_ID, AUTH_APPLE_KEY_ID and AUTH_APPLE_PRIVATE_KEY must all be set",
    );
  }
  return {
    clientId,
    teamId,
    keyId,
    privateKey: privateKey.replace(/\\n/g, "\n"),
  };
}

export async function buildAppleClientSecret(): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  if (cache && cache.expiresAt - EARLY_REFRESH_SECONDS > nowSec) {
    return cache.token;
  }
  const { clientId, teamId, keyId, privateKey } = readEnv();
  const key = await importPKCS8(privateKey, "ES256");
  const exp = nowSec + MAX_TTL_SECONDS;
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setAudience("https://appleid.apple.com")
    .setSubject(clientId)
    .setIssuedAt(nowSec)
    .setExpirationTime(exp)
    .sign(key);
  cache = { token, expiresAt: exp };
  return token;
}
