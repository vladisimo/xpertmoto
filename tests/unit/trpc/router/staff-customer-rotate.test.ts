import { beforeEach, describe, expect, it, vi } from "vitest";

const downloadFile = vi.fn();
const uploadFile = vi.fn();
const deleteFile = vi.fn();
const rotateImage = vi.fn();

vi.mock("@/lib/storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage")>(
    "@/lib/storage",
  );
  return {
    ...actual,
    downloadFile: (...args: unknown[]) => downloadFile(...args),
    uploadFile: (...args: unknown[]) => uploadFile(...args),
    deleteFile: (...args: unknown[]) => deleteFile(...args),
    getSignedUrl: vi.fn().mockResolvedValue("https://signed.example/key"),
  };
});

vi.mock("@/lib/image-processing", async () => {
  const actual = await vi.importActual<typeof import("@/lib/image-processing")>(
    "@/lib/image-processing",
  );
  return {
    ...actual,
    rotateImage: (...args: unknown[]) => rotateImage(...args),
  };
});

import { staffCustomerRouter } from "@/server/trpc/router/staff-customer";

type Caller = ReturnType<typeof staffCustomerRouter.createCaller>;

interface MockState {
  documents: Map<string, { id: string; customerId: string; fileUrl: string; metadata: unknown }>;
  profile: { userId: string; licenceImageFront: string | null; licenceImageBack: string | null; passportImage: string | null; signatureImage: string | null };
}

function makeCtx() {
  const state: MockState = {
    documents: new Map([
      ["doc1", { id: "doc1", customerId: "cust1", fileUrl: "customer-documents/abc.jpg", metadata: { kind: "licence" } }],
      ["doc-pdf", { id: "doc-pdf", customerId: "cust1", fileUrl: "customer-documents/contract.pdf", metadata: null }],
      ["doc-other", { id: "doc-other", customerId: "OTHER_CUST", fileUrl: "customer-documents/xyz.jpg", metadata: null }],
    ]),
    profile: {
      userId: "cust1",
      licenceImageFront: "drivers/cust1/licence-front.jpg",
      licenceImageBack: null,
      passportImage: null,
      signatureImage: null,
    },
  };

  const prisma = {
    customerDocument: {
      findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        return Promise.resolve(state.documents.get(where.id) ?? null);
      }),
      update: vi.fn().mockImplementation(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const doc = state.documents.get(where.id);
        if (doc) Object.assign(doc, data);
        return Promise.resolve(doc);
      }),
    },
    customerProfile: {
      findUnique: vi.fn().mockImplementation(({ where }: { where: { userId: string } }) => {
        if (state.profile.userId !== where.userId) return Promise.resolve(null);
        return Promise.resolve({ ...state.profile });
      }),
      update: vi.fn().mockImplementation(({ where, data }: { where: { userId: string }; data: Record<string, unknown> }) => {
        if (state.profile.userId === where.userId) Object.assign(state.profile, data);
        return Promise.resolve({ ...state.profile });
      }),
    },
  };

  return {
    ctx: {
      prisma,
      user: { id: "staff1", role: "STAFF" },
      session: { user: { id: "staff1", role: "STAFF" } },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
    } as unknown as Parameters<Caller["rotateDocument"]>[0],
    state,
    prisma,
  };
}

function caller(ctx: unknown): Caller {
  return staffCustomerRouter.createCaller(ctx as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  downloadFile.mockResolvedValue(Buffer.from([1, 2, 3]));
  rotateImage.mockResolvedValue({
    buffer: Buffer.from([9, 9, 9]),
    contentType: "image/jpeg",
    width: 100,
    height: 200,
    rotated: true,
  });
  uploadFile.mockResolvedValue({
    key: "customer-documents/new-rotated.jpg",
    url: "https://storage/customer-documents/new-rotated.jpg",
  });
  deleteFile.mockResolvedValue(undefined);
});

describe("staffCustomer.rotateDocument", () => {
  it("rotates a CustomerDocument: downloads → rotates → uploads to same folder → updates fileUrl → clears metadata → deletes old key", async () => {
    const { ctx, state, prisma } = makeCtx();
    const c = caller(ctx);

    await c.rotateDocument({
      customerId: "cust1",
      target: { kind: "document", documentId: "doc1" },
    });

    expect(downloadFile).toHaveBeenCalledWith("customer-documents/abc.jpg");
    expect(rotateImage).toHaveBeenCalledWith(expect.any(Buffer), 90);
    expect(uploadFile).toHaveBeenCalledWith({
      folder: "customer-documents",
      contentType: "image/jpeg",
      body: expect.any(Buffer),
    });
    expect(prisma.customerDocument.update).toHaveBeenCalledTimes(1);
    const updated = state.documents.get("doc1");
    expect(updated?.fileUrl).toBe("https://storage/customer-documents/new-rotated.jpg");
    expect(updated?.metadata).toBeDefined();
    expect(deleteFile).toHaveBeenCalledWith("customer-documents/abc.jpg");
  });

  it("rotates a CustomerProfile slot: updates the slot with the new URL", async () => {
    const { ctx, state, prisma } = makeCtx();
    const c = caller(ctx);

    await c.rotateDocument({
      customerId: "cust1",
      target: { kind: "profile", slot: "licenceImageFront" },
    });

    expect(downloadFile).toHaveBeenCalledWith("drivers/cust1/licence-front.jpg");
    expect(uploadFile).toHaveBeenCalledWith({
      folder: "drivers/cust1",
      contentType: "image/jpeg",
      body: expect.any(Buffer),
    });
    expect(prisma.customerProfile.update).toHaveBeenCalledTimes(1);
    expect(state.profile.licenceImageFront).toBe(
      "https://storage/customer-documents/new-rotated.jpg",
    );
  });

  it("rejects PDF documents with BAD_REQUEST and never touches storage", async () => {
    const { ctx } = makeCtx();
    const c = caller(ctx);

    await expect(
      c.rotateDocument({
        customerId: "cust1",
        target: { kind: "document", documentId: "doc-pdf" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(downloadFile).not.toHaveBeenCalled();
    expect(rotateImage).not.toHaveBeenCalled();
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("rejects when the document belongs to a different customer", async () => {
    const { ctx } = makeCtx();
    const c = caller(ctx);

    await expect(
      c.rotateDocument({
        customerId: "cust1",
        target: { kind: "document", documentId: "doc-other" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(downloadFile).not.toHaveBeenCalled();
  });

  it("rejects when the profile slot is empty", async () => {
    const { ctx } = makeCtx();
    const c = caller(ctx);

    await expect(
      c.rotateDocument({
        customerId: "cust1",
        target: { kind: "profile", slot: "passportImage" },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
