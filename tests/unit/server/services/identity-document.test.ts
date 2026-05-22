// Crypto module reads SECRET_ENC_KEY at first call — set it before
// importing any module that encrypts (writePiiField inside the service).
// Must be 32 bytes encoded as base64 (AES-256 key size).
process.env.SECRET_ENC_KEY ??= Buffer.alloc(32, 7).toString("base64");

import { describe, expect, test, vi } from "vitest";

import { applyLatestDocumentToProfile } from "@/server/services/identity-document";

/**
 * Mock transaction client — only implements what the service uses:
 * customerDocument.findFirst and customerProfile.update + findUnique.
 */
type FakeDoc = {
  id: string;
  fileUrl: string;
  expiryDate: Date | null;
  metadata: unknown;
  createdAt: Date;
};

interface FakeProfile {
  licenceNumber?: string | null;
  licenceNumberEnc?: unknown;
  licenceState?: string | null;
  licenceExpiry?: Date | null;
  licenceClass?: string | null;
  passportNumber?: string | null;
  passportNumberEnc?: unknown;
  passportCountry?: string | null;
  passportExpiry?: Date | null;
}

function makeTx(docs: FakeDoc[], profile: FakeProfile | null = {}) {
  const updateCalls: Array<{ where: unknown; data: Record<string, unknown> }> = [];
  const tx = {
    customerDocument: {
      findFirst: vi.fn(async () => docs[0] ?? null),
    },
    customerProfile: {
      findUnique: vi.fn(async () => profile),
      update: vi.fn(async (args: { where: unknown; data: Record<string, unknown> }) => {
        updateCalls.push(args);
        return {} as unknown;
      }),
    },
  };
  return { tx, updateCalls };
}

describe("applyLatestDocumentToProfile", () => {
  test("LICENCE_FRONT with no rows clears the image slot", async () => {
    const { tx, updateCalls } = makeTx([]);
    await applyLatestDocumentToProfile(
      tx as unknown as Parameters<typeof applyLatestDocumentToProfile>[0],
      "user-1",
      "LICENCE_FRONT",
    );
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]!.data).toEqual({ licenceImageFront: null });
  });

  test("LICENCE_BACK projects the newest row's fileUrl", async () => {
    const doc: FakeDoc = {
      id: "d1",
      fileUrl: "drivers/user-1/2026-04/abc.jpg",
      expiryDate: null,
      metadata: null,
      createdAt: new Date(),
    };
    const { tx, updateCalls } = makeTx([doc]);
    await applyLatestDocumentToProfile(
      tx as unknown as Parameters<typeof applyLatestDocumentToProfile>[0],
      "user-1",
      "LICENCE_BACK",
    );
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]!.data).toEqual({ licenceImageBack: doc.fileUrl });
  });

  test("LICENCE_BACK returns silently when profile is missing", async () => {
    const doc: FakeDoc = {
      id: "d1",
      fileUrl: "drivers/user-1/2026-04/back.jpg",
      expiryDate: null,
      metadata: null,
      createdAt: new Date(),
    };
    const { tx, updateCalls } = makeTx([doc], null);
    await applyLatestDocumentToProfile(
      tx as unknown as Parameters<typeof applyLatestDocumentToProfile>[0],
      "user-1",
      "LICENCE_BACK",
    );
    expect(updateCalls).toHaveLength(0);
  });

  test("LICENCE_FRONT projects image and fills empty text fields from metadata", async () => {
    const doc: FakeDoc = {
      id: "d1",
      fileUrl: "drivers/user-1/2026-04/front.jpg",
      expiryDate: new Date("2030-01-01"),
      metadata: {
        kind: "licence",
        detectedAt: new Date().toISOString(),
        confidence: 0.9,
        licenceNumber: "12345678",
        state: "QLD",
        licenceClass: "RE",
      },
      createdAt: new Date(),
    };
    // Empty profile — every detected field is writable.
    const { tx, updateCalls } = makeTx([doc], {});
    await applyLatestDocumentToProfile(
      tx as unknown as Parameters<typeof applyLatestDocumentToProfile>[0],
      "user-1",
      "LICENCE_FRONT",
    );
    const data = updateCalls[0]!.data;
    expect(data.licenceImageFront).toBe(doc.fileUrl);
    expect(data.licenceState).toBe("QLD");
    expect(data.licenceClass).toBe("RE");
    // Encrypted-licence-number write path goes through writePiiField, which
    // sets both plaintext-null and *Enc with an encrypted envelope.
    expect(data).toHaveProperty("licenceNumber", null);
    expect(data).toHaveProperty("licenceNumberEnc");
    // Expiry: doc.expiryDate wins over metadata.
    expect(data.licenceExpiry).toEqual(new Date("2030-01-01"));
  });

  test("LICENCE_FRONT never overwrites a staff-entered licenceClass", async () => {
    const doc: FakeDoc = {
      id: "d1",
      fileUrl: "drivers/user-1/front.jpg",
      expiryDate: null,
      metadata: { kind: "licence", confidence: 0.9, licenceClass: "R", detectedAt: "x" },
      createdAt: new Date(),
    };
    const { tx, updateCalls } = makeTx([doc], { licenceClass: "RE" });
    await applyLatestDocumentToProfile(
      tx as unknown as Parameters<typeof applyLatestDocumentToProfile>[0],
      "user-1",
      "LICENCE_FRONT",
    );
    const data = updateCalls[0]!.data;
    // Image slot is always projected; licenceClass is preserved.
    expect(data.licenceImageFront).toBe(doc.fileUrl);
    expect(data.licenceClass).toBeUndefined();
  });

  test("PASSPORT projects image + fills passport fields when empty", async () => {
    const doc: FakeDoc = {
      id: "d1",
      fileUrl: "drivers/user-1/passport.jpg",
      expiryDate: new Date("2032-06-01"),
      metadata: {
        kind: "passport",
        detectedAt: "x",
        confidence: 0.95,
        passportNumber: "PA1234567",
        country: "AU",
      },
      createdAt: new Date(),
    };
    const { tx, updateCalls } = makeTx([doc], {});
    await applyLatestDocumentToProfile(
      tx as unknown as Parameters<typeof applyLatestDocumentToProfile>[0],
      "user-1",
      "PASSPORT",
    );
    const data = updateCalls[0]!.data;
    expect(data.passportImage).toBe(doc.fileUrl);
    expect(data.passportCountry).toBe("AU");
    expect(data.passportExpiry).toEqual(new Date("2032-06-01"));
    expect(data).toHaveProperty("passportNumberEnc");
  });

  test("PASSPORT with no rows clears the image slot but leaves passport number alone", async () => {
    const { tx, updateCalls } = makeTx([], { passportNumber: "legacy" });
    await applyLatestDocumentToProfile(
      tx as unknown as Parameters<typeof applyLatestDocumentToProfile>[0],
      "user-1",
      "PASSPORT",
    );
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]!.data).toEqual({ passportImage: null });
  });

  test("non-projectable types (VISA, OTHER) are a no-op", async () => {
    const { tx, updateCalls } = makeTx([]);
    await applyLatestDocumentToProfile(
      tx as unknown as Parameters<typeof applyLatestDocumentToProfile>[0],
      "user-1",
      "VISA",
    );
    expect(updateCalls).toHaveLength(0);
  });
});
