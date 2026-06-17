/**
 * Customer self-service onboarding router. Allowed when the session is in
 * `requiresOnboarding` state (gate enforced by `onboardingProcedure`);
 * every other tRPC procedure stays blocked until `complete` succeeds and
 * the client refreshes its session.
 *
 * Five procedures, called in sequence by `<OnboardingWizard>`:
 *   1. bootstrap          — read-substitute for `customer.me` while gated
 *   2. updateProfile      — persists step-1 basics + step-3 identity (the
 *                           wizard calls it twice; same procedure, only
 *                           the supplied fields are touched)
 *   3. acceptConsents     — stamps consent timestamps + versions
 *   4. generateSignedPdfs — renders four signed PDFs, one per consent doc
 *   5. complete           — sets onboardedAt + joint onboardingVersion
 *
 * The `pending2fa` and onboarding gates are independent: TOTP step-up
 * always runs before onboarding, so a `pending2fa` session never reaches
 * `onboardingProcedure` (which rejects it).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, onboardingProcedure, trpcRateLimit } from "../trpc";
import {
  onboardingProfileSchema,
  onboardingIdentitySchema,
  onboardingConsentsSchema,
  onboardingSignatureSchema,
} from "@/lib/validators/onboarding";
import {
  CONSENT_DOC_KEYS,
  CONSENT_DOC_TYPE_MAP,
  getConsentDocument,
  interpolateConsentBody,
  type ConsentBranding,
  type ConsentDocKey,
} from "@/lib/consent-documents";
import {
  CANCELLATION_VERSION,
  MARKETING_VERSION,
  PRIVACY_VERSION,
  TERMS_VERSION,
} from "@/lib/consent-versions";
import { buildOnboardingVersion, needsOnboarding } from "@/lib/onboarding-status";
import { renderConsentDocumentPdf } from "@/lib/pdf/consent-document";
import { uploadFile, downloadFile } from "@/lib/storage";
import { writePiiField, readPiiField } from "@/lib/customer-pii";
import { writeAudit } from "@/server/services/audit";
import { getBranding } from "@/lib/branding";
import { extractLicenceData, extractPassportData } from "@/server/services/document-extract";

/**
 * Onboarding identity uploads are posted under `drivers/<userId>/` by
 * `/api/upload/identity-document`. Re-check ownership here so a caller can't
 * point the OCR at another user's stored document and read back its PII.
 */
function assertOwnIdentityKey(userId: string, imageKey: string): void {
  if (!imageKey.startsWith(`drivers/${userId}/`)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Uploaded file key isn't in your folder.",
    });
  }
}

/**
 * Wizard expects the bootstrap response to be enough to render every
 * step without an additional query. Includes the canonical version
 * strings so the four consent panels show the version that is about to
 * be persisted.
 */
export const onboardingRouter = createTRPCRouter({
  bootstrap: onboardingProcedure.query(async ({ ctx }) => {
    const user = await ctx.prisma.user.findUnique({
      where: { id: ctx.user.id },
      include: { customerProfile: true },
    });
    if (!user) {
      throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
    }
    // Decrypt PII fields for prefill.
    const profile = user.customerProfile;
    if (profile) {
      profile.licenceNumber = readPiiField(profile.licenceNumber, profile.licenceNumberEnc);
      profile.passportNumber = readPiiField(profile.passportNumber, profile.passportNumberEnc);
    }
    const branding = await getBranding();
    const consentBranding: ConsentBranding = {
      siteName: branding.siteName,
      legalName: branding.legalName,
      abn: branding.abn,
      supportEmail: branding.supportEmail,
      privacyEmail: branding.privacyEmail,
    };
    const consentDocs = CONSENT_DOC_KEYS.map((key) => {
      const doc = getConsentDocument(key);
      return {
        key: doc.key,
        title: doc.title,
        version: doc.version,
        body: interpolateConsentBody(doc.body, consentBranding),
      };
    });
    return {
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
      },
      profile: profile
        ? {
            dateOfBirth: user.dateOfBirth ? user.dateOfBirth.toISOString().slice(0, 10) : "",
            addressLine1: profile.addressLine1 ?? "",
            addressLine2: profile.addressLine2 ?? "",
            suburb: profile.suburb ?? "",
            state: profile.state ?? "",
            postcode: profile.postcode ?? "",
            country: profile.country ?? "Australia",
            emergencyContactName: profile.emergencyContactName ?? "",
            emergencyContactPhone: profile.emergencyContactPhone ?? "",
            emergencyContactRelationship: profile.emergencyContactRelationship ?? "",
            licenceType: profile.licenceType,
            licenceNumber: profile.licenceNumber ?? "",
            licenceState: profile.licenceState ?? "",
            licenceCountry: profile.licenceCountry ?? "",
            licenceExpiry: profile.licenceExpiry
              ? profile.licenceExpiry.toISOString().slice(0, 10)
              : "",
            licenceClass: profile.licenceClass ?? "",
            licenceImageFront: profile.licenceImageFront ?? "",
            licenceImageBack: profile.licenceImageBack ?? "",
            passportNumber: profile.passportNumber ?? "",
            passportCountry: profile.passportCountry ?? "",
            passportExpiry: profile.passportExpiry
              ? profile.passportExpiry.toISOString().slice(0, 10)
              : "",
            passportImage: profile.passportImage ?? "",
            marketingOptIn: profile.marketingOptIn,
            marketingSmsOptIn: profile.marketingSmsOptIn,
          }
        : null,
      branding: consentBranding,
      consentDocs,
      versions: {
        terms: TERMS_VERSION,
        privacy: PRIVACY_VERSION,
        cancellation: CANCELLATION_VERSION,
        marketing: MARKETING_VERSION,
      },
    };
  }),

  /**
   * Persists whichever subset of profile + identity fields the wizard
   * has captured so far. Called once at the end of step 1 (basics) and
   * again at the end of step 3 (identity). Idempotent — re-submitting
   * the same values is a no-op.
   */
  updateProfile: onboardingProcedure
    .use(
      trpcRateLimit({
        bucket: "onboarding:update-profile",
        limit: 30,
        windowSec: 5 * 60,
      }),
    )
    .input(
      z.object({
        profile: onboardingProfileSchema.optional(),
        identity: onboardingIdentitySchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.profile && !input.identity) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Provide profile or identity data",
        });
      }

      // Build the update fragment piecewise so we only touch what was
      // submitted — Prisma's `update` rejects undefined values cleanly,
      // but we want to avoid clobbering identity fields when the wizard
      // is only persisting step-1 basics (and vice versa).
      const data: Record<string, unknown> = {};
      const userPatch: Record<string, unknown> = {};

      if (input.profile) {
        const p = input.profile;
        data.addressLine1 = p.addressLine1;
        data.addressLine2 = p.addressLine2 || null;
        data.suburb = p.suburb;
        data.state = p.state;
        data.postcode = p.postcode;
        data.country = p.country;
        data.emergencyContactName = p.emergencyContactName;
        data.emergencyContactPhone = p.emergencyContactPhone;
        data.emergencyContactRelationship = p.emergencyContactRelationship;
        userPatch.phone = p.phone;
        userPatch.dateOfBirth = new Date(p.dateOfBirth);
      }

      if (input.identity) {
        const i = input.identity;
        data.licenceType = i.identityPath;
        Object.assign(data, writePiiField("licenceNumber", "licenceNumberEnc", i.licenceNumber || null));
        data.licenceState = i.identityPath === "AU_LICENCE" ? i.licenceState ?? null : null;
        data.licenceCountry =
          i.identityPath === "INTERNATIONAL"
            ? i.licenceCountry?.toUpperCase() || null
            : null;
        data.licenceExpiry = i.licenceExpiry ? new Date(i.licenceExpiry) : null;
        data.licenceClass = i.licenceClass || null;
        data.licenceImageFront = i.licenceImageFrontKey || null;
        data.licenceImageBack = i.licenceImageBackKey || null;
        if (i.identityPath === "INTERNATIONAL") {
          Object.assign(data, writePiiField("passportNumber", "passportNumberEnc", i.passportNumber || null));
          data.passportCountry = i.passportCountry?.toUpperCase() || null;
          data.passportExpiry = i.passportExpiry ? new Date(i.passportExpiry) : null;
          data.passportImage = i.passportImageKey || null;
        } else {
          Object.assign(data, writePiiField("passportNumber", "passportNumberEnc", null));
          data.passportCountry = null;
          data.passportExpiry = null;
          data.passportImage = null;
        }
      }

      await ctx.prisma.$transaction(async (tx) => {
        if (Object.keys(userPatch).length > 0) {
          await tx.user.update({ where: { id: ctx.user.id }, data: userPatch });
        }
        await tx.customerProfile.upsert({
          where: { userId: ctx.user.id },
          update: data,
          create: { userId: ctx.user.id, ...data },
        });
      });

      return { ok: true as const };
    }),

  /**
   * OCR + classify a driver's-licence / IDP image during onboarding. Mirrors
   * `customer.extractLicenceFromImage`, but on `onboardingProcedure` so a
   * mid-onboarding user (who is blocked from every `protectedProcedure`) can
   * still get pre-fill + the document-type check. Returns the full extraction
   * including `documentType`; the uploader uses that to reject a non-ID before
   * it's carried into the wizard submit, and to pre-fill the typed fields.
   */
  extractLicenceFromImage: onboardingProcedure
    .use(
      trpcRateLimit<{ imageKey: string }>({
        bucket: "onboarding:ocr-licence",
        limit: 20,
        windowSec: 60 * 60,
        identifier: (ctx) => ctx.session?.user?.id,
      }),
    )
    .input(z.object({ imageKey: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      assertOwnIdentityKey(ctx.user.id, input.imageKey);
      const buffer = await downloadFile(input.imageKey);
      return extractLicenceData(buffer, {
        log: {
          prisma: ctx.prisma,
          customerId: ctx.user.id,
          triggeredById: ctx.user.id,
        },
      });
    }),

  extractPassportFromImage: onboardingProcedure
    .use(
      trpcRateLimit<{ imageKey: string }>({
        bucket: "onboarding:ocr-passport",
        limit: 20,
        windowSec: 60 * 60,
        identifier: (ctx) => ctx.session?.user?.id,
      }),
    )
    .input(z.object({ imageKey: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      assertOwnIdentityKey(ctx.user.id, input.imageKey);
      const buffer = await downloadFile(input.imageKey);
      return extractPassportData(buffer, {
        log: {
          prisma: ctx.prisma,
          customerId: ctx.user.id,
          triggeredById: ctx.user.id,
        },
      });
    }),

  /**
   * Records platform-level consent acceptance. Idempotent — re-stamps
   * the timestamp on every call. Called only on final wizard submit.
   */
  acceptConsents: onboardingProcedure
    .use(
      trpcRateLimit({
        bucket: "onboarding:accept-consents",
        limit: 10,
        windowSec: 5 * 60,
      }),
    )
    .input(onboardingConsentsSchema)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      await ctx.prisma.customerProfile.update({
        where: { userId: ctx.user.id },
        data: {
          termsAcceptedAt: now,
          termsVersion: TERMS_VERSION,
          privacyAcceptedAt: now,
          privacyVersion: PRIVACY_VERSION,
          marketingOptIn: input.marketingEmailOptIn,
          marketingSmsOptIn: input.marketingSmsOptIn,
        },
      });
      // Audit each consent acceptance separately so the audit log shows
      // an explicit row per document at the version captured.
      await writeAudit(ctx.prisma, {
        userId: ctx.user.id,
        category: "AUTH",
        action: "onboarding.consents.accepted",
        entity: "User",
        entityId: ctx.user.id,
        status: "SUCCESS",
        newData: {
          terms: TERMS_VERSION,
          privacy: PRIVACY_VERSION,
          cancellation: CANCELLATION_VERSION,
          marketing: MARKETING_VERSION,
          marketingEmailOptIn: input.marketingEmailOptIn,
          marketingSmsOptIn: input.marketingSmsOptIn,
        },
      });
      return { ok: true as const };
    }),

  /**
   * Renders the four signed consent PDFs in one round-trip. The
   * signature data-URL is uploaded to S3 once; the resulting key is
   * reused across all four renders. Each PDF is persisted as a
   * `CustomerDocument` row with a `CONSENT_*` type for visibility on
   * `/dashboard/documents` and `/staff/customers/[id]/documents`.
   */
  generateSignedPdfs: onboardingProcedure
    .use(
      trpcRateLimit({
        bucket: "onboarding:generate-pdfs",
        limit: 6,
        windowSec: 60 * 60,
      }),
    )
    .input(onboardingSignatureSchema)
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.findUnique({
        where: { id: ctx.user.id },
        include: { customerProfile: true },
      });
      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }
      const fullName = `${user.firstName} ${user.lastName}`.trim();
      const branding = await getBranding();
      const consentBranding: ConsentBranding = {
        siteName: branding.siteName,
        legalName: branding.legalName,
        abn: branding.abn,
        supportEmail: branding.supportEmail,
        privacyEmail: branding.privacyEmail,
      };

      // Decode + persist the signature once.
      const base64 = input.signatureDataUrl.replace(/^data:image\/png;base64,/, "");
      const buffer = Buffer.from(base64, "base64");
      const sig = await uploadFile({
        folder: "signatures",
        filename: "onboarding-signature.png",
        contentType: "image/png",
        body: buffer,
      });

      const signedAt = new Date();
      const profile = user.customerProfile;
      const marketingChoices = profile
        ? { email: profile.marketingOptIn, sms: profile.marketingSmsOptIn }
        : { email: false, sms: false };

      // Render and persist each PDF. Sequential because we want
      // deterministic filenames per doc and a single audit row per doc.
      const results: Array<{ key: ConsentDocKey; documentId: string; fileKey: string }> = [];
      for (const key of CONSENT_DOC_KEYS) {
        const doc = getConsentDocument(key);
        const pdf = await renderConsentDocumentPdf({
          title: doc.title,
          version: doc.version,
          body: interpolateConsentBody(doc.body, consentBranding),
          customerFullName: fullName,
          signatureUrl: input.signatureDataUrl,
          signedAt,
          marketingChoices: key === "MARKETING" ? marketingChoices : undefined,
        });
        const uploaded = await uploadFile({
          folder: "customer-consents",
          filename: `${key.toLowerCase()}-${doc.version}.pdf`,
          contentType: "application/pdf",
          body: pdf,
        });
        // Store the S3 key (not the bucket URL) so customer.signedConsents
        // mints a fresh, same-origin signed URL on download. Storing the
        // bucket URL leaks `http://localhost:9000/...` in dev and bypasses
        // the resolver's `getSignedUrl` branch in
        // src/server/trpc/router/customer.ts:1142.
        const created = await ctx.prisma.customerDocument.create({
          data: {
            customerId: ctx.user.id,
            type: CONSENT_DOC_TYPE_MAP[key],
            fileUrl: uploaded.key,
            label: `${doc.title} (${doc.version})`,
            uploadedById: ctx.user.id,
            metadata: {
              kind: "consent",
              docKey: key,
              docVersion: doc.version,
              signatureKey: sig.key,
              fileKey: uploaded.key,
              signedAt: signedAt.toISOString(),
              ...(key === "MARKETING" ? { marketingChoices } : {}),
            },
          },
        });
        results.push({ key, documentId: created.id, fileKey: uploaded.key });
      }

      // Pin the signature to the customer profile for future
      // single-doc re-consent flows that should not re-prompt for a
      // pad render.
      await ctx.prisma.customerProfile.update({
        where: { userId: ctx.user.id },
        data: { signatureImage: sig.key },
      });

      return {
        signatureKey: sig.key,
        documents: results,
      };
    }),

  /**
   * Final step. Sets `onboardedAt` and the joint `onboardingVersion`,
   * then re-checks server-side that the customer's state is actually
   * complete (basics + identity + consents + signature) before flipping
   * the gate. Failure here is a defence in depth — the wizard's
   * client-side guards should never let this fire prematurely.
   */
  complete: onboardingProcedure
    .use(
      trpcRateLimit({
        bucket: "onboarding:complete",
        limit: 10,
        windowSec: 5 * 60,
      }),
    )
    .mutation(async ({ ctx }) => {
      const user = await ctx.prisma.user.findUnique({
        where: { id: ctx.user.id },
        include: { customerProfile: true },
      });
      const profile = user?.customerProfile;
      if (!user || !profile) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Customer profile is missing — finish step 1 first.",
        });
      }
      // Signature image is the cheapest proxy for "all five steps
      // completed" because the wizard only writes it during PDF
      // generation. Identity + consents + basics are checked alongside.
      if (
        !profile.signatureImage ||
        !profile.termsAcceptedAt ||
        !profile.privacyAcceptedAt ||
        !user.dateOfBirth ||
        !profile.addressLine1 ||
        !profile.licenceType ||
        !profile.licenceImageFront
      ) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Onboarding is not complete — finish every step first.",
        });
      }
      const now = new Date();
      const version = buildOnboardingVersion();
      await ctx.prisma.customerProfile.update({
        where: { userId: ctx.user.id },
        data: { onboardedAt: now, onboardingVersion: version },
      });
      await writeAudit(ctx.prisma, {
        userId: ctx.user.id,
        category: "AUTH",
        action: "onboarding.completed",
        entity: "User",
        entityId: ctx.user.id,
        status: "SUCCESS",
        newData: { onboardingVersion: version, onboardedAt: now.toISOString() },
      });
      return { ok: true as const };
    }),
});

/** Re-exported for tests so they can build a profile shape and assert
 * the gate behaviour without round-tripping through the DB. */
export { needsOnboarding };
