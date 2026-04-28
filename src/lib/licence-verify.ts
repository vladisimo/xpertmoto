import { logger } from "@/lib/logger";
import { getSecret } from "@/lib/integration-config";

export async function licenceVerifyEnabled(): Promise<boolean> {
  return !!(await getSecret("integration:stripe:secretKey", "STRIPE_SECRET_KEY"));
}

export type VerificationSession = {
  id: string;
  clientSecret: string;
  url: string;
  status: "requires_input" | "processing" | "verified" | "canceled" | "failed";
};

type StripeIdentityClient = {
  identity: {
    verificationSessions: {
      create: (params: Record<string, unknown>) => Promise<{
        id: string;
        client_secret: string | null;
        url: string | null;
        status: string;
      }>;
      retrieve: (id: string) => Promise<{
        id: string;
        status: string;
        last_verification_report: string | null;
      }>;
    };
  };
};

async function getClient(): Promise<StripeIdentityClient | null> {
  const key = await getSecret("integration:stripe:secretKey", "STRIPE_SECRET_KEY");
  if (!key) return null;
  try {
    const req = eval("require") as NodeRequire;
    const Stripe = req("stripe");
    const Ctor = Stripe.default ?? Stripe;
    return new Ctor(key, { apiVersion: "2024-09-30.acacia" }) as StripeIdentityClient;
  } catch {
    return null;
  }
}

function normaliseStatus(s: string): VerificationSession["status"] {
  switch (s) {
    case "verified":
    case "processing":
    case "canceled":
      return s;
    case "requires_input":
      return "requires_input";
    default:
      return "failed";
  }
}

/**
 * Create a Stripe Identity verification session for a customer's driver
 * licence. The returned URL can be redirected to so the customer uploads
 * ID documents on Stripe-hosted pages. Status is polled via getStatus().
 */
export async function createLicenceVerification(params: {
  customerId: string;
  returnUrl: string;
}): Promise<VerificationSession> {
  const client = await getClient();
  if (!client) {
    return {
      id: `vs_stub_${params.customerId}`,
      clientSecret: `cs_stub_${params.customerId}`,
      url: params.returnUrl,
      status: "requires_input",
    };
  }
  const session = await client.identity.verificationSessions.create({
    type: "document",
    metadata: { customerId: params.customerId },
    options: {
      document: {
        allowed_types: ["driving_license"],
        require_live_capture: true,
        require_matching_selfie: true,
      },
    },
    return_url: params.returnUrl,
  });
  return {
    id: session.id,
    clientSecret: session.client_secret ?? "",
    url: session.url ?? params.returnUrl,
    status: normaliseStatus(session.status),
  };
}

export async function getLicenceVerificationStatus(
  sessionId: string,
): Promise<VerificationSession["status"]> {
  const client = await getClient();
  if (!client) return "requires_input";
  try {
    const s = await client.identity.verificationSessions.retrieve(sessionId);
    return normaliseStatus(s.status);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), sessionId },
      "stripe identity retrieve failed",
    );
    return "failed";
  }
}
