import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyReferral,
  ensureReferralCode,
  generateReferralCode,
  qualifyReferral,
} from "../../../src/server/services/referral";

describe("referral service", () => {
  describe("generateReferralCode", () => {
    it("uses initials + 4-char suffix for named users", () => {
      const code = generateReferralCode("Ada", "Lovelace");
      expect(code).toMatch(/^AL-[A-Z2-9]{4}$/);
    });
    it("falls back to RIDE prefix if name missing", () => {
      expect(generateReferralCode()).toMatch(/^RIDE-[A-Z2-9]{4}$/);
      expect(generateReferralCode("Only")).toMatch(/^RIDE-[A-Z2-9]{4}$/);
    });
  });

  describe("ensureReferralCode", () => {
    function makePrisma(options: {
      existingCode?: string | null;
      profileExists?: boolean;
      collisionCount?: number;
    } = {}) {
      const existingCode = options.existingCode ?? null;
      const profileExists = options.profileExists ?? true;
      let calls = 0;
      return {
        user: {
          findUniqueOrThrow: vi.fn().mockResolvedValue({
            id: "u1",
            firstName: "Ava",
            lastName: "Lee",
            customerProfile: profileExists
              ? { referralCode: existingCode }
              : null,
          }),
        },
        customerProfile: {
          findUnique: vi.fn().mockImplementation(async () => {
            calls += 1;
            if (calls <= (options.collisionCount ?? 0)) return { id: "collision" };
            return null;
          }),
          update: vi.fn().mockResolvedValue({}),
        },
      } as never;
    }

    beforeEach(() => vi.clearAllMocks());

    it("returns existing code unchanged", async () => {
      const prisma = makePrisma({ existingCode: "AL-ABCD" });
      const code = await ensureReferralCode(prisma, "u1");
      expect(code).toBe("AL-ABCD");
    });

    it("generates and persists a new code when none exists", async () => {
      const prisma = makePrisma();
      const code = await ensureReferralCode(prisma, "u1");
      expect(code).toMatch(/^AL-[A-Z2-9]{4}$/);
      expect(
        (prisma as unknown as { customerProfile: { update: ReturnType<typeof vi.fn> } })
          .customerProfile.update,
      ).toHaveBeenCalledOnce();
    });

    it("retries on collision", async () => {
      const prisma = makePrisma({ collisionCount: 2 });
      const code = await ensureReferralCode(prisma, "u1");
      expect(code).toMatch(/^AL-[A-Z2-9]{4}$/);
    });

    it("throws when user has no customer profile", async () => {
      const prisma = makePrisma({ profileExists: false });
      await expect(ensureReferralCode(prisma, "u1")).rejects.toThrow(/customer profile/i);
    });
  });

  describe("applyReferral", () => {
    function makePrisma(opts: {
      referrerUserId?: string | null;
      existing?: unknown;
    } = {}) {
      return {
        customerProfile: {
          findUnique: vi.fn().mockResolvedValue(
            opts.referrerUserId ? { userId: opts.referrerUserId } : null,
          ),
        },
        referral: {
          findFirst: vi.fn().mockResolvedValue(opts.existing ?? null),
          create: vi.fn().mockImplementation(async ({ data }) => ({ id: "r1", ...data })),
        },
      } as never;
    }

    it("returns null for unknown code", async () => {
      const prisma = makePrisma({ referrerUserId: null });
      const res = await applyReferral(prisma, { code: "XX-XXXX", refereeId: "u2" });
      expect(res).toBeNull();
    });

    it("blocks self-referral", async () => {
      const prisma = makePrisma({ referrerUserId: "u1" });
      const res = await applyReferral(prisma, { code: "AL-ABCD", refereeId: "u1" });
      expect(res).toBeNull();
    });

    it("creates PENDING row on happy path", async () => {
      const prisma = makePrisma({ referrerUserId: "u1" });
      const res = await applyReferral(prisma, { code: "AL-ABCD", refereeId: "u2" });
      expect(res).toEqual(expect.objectContaining({ status: "PENDING" }));
    });

    it("returns existing referral instead of creating duplicate", async () => {
      const prisma = makePrisma({ referrerUserId: "u1", existing: { id: "existing" } });
      const res = await applyReferral(prisma, { code: "AL-ABCD", refereeId: "u2" });
      expect(res).toEqual({ id: "existing" });
    });
  });

  describe("qualifyReferral", () => {
    function makePrisma(pending: unknown) {
      const tx = {
        referral: {
          update: vi.fn().mockImplementation(async ({ data }) => ({ id: "r1", ...data })),
        },
        customerProfile: { update: vi.fn() },
      };
      return {
        referral: { findFirst: vi.fn().mockResolvedValue(pending) },
        $transaction: vi
          .fn()
          .mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx)),
        __tx: tx,
      } as never;
    }

    it("returns null when no pending referral exists", async () => {
      const prisma = makePrisma(null);
      const res = await qualifyReferral(prisma, {
        refereeId: "u2",
        qualifyingBookingId: "b1",
      });
      expect(res).toBeNull();
    });

    it("flips status to QUALIFIED and credits referrer", async () => {
      const prisma = makePrisma({
        id: "r1",
        referrerId: "u1",
        rewardAmount: 20,
      });
      const res = await qualifyReferral(prisma, {
        refereeId: "u2",
        qualifyingBookingId: "b1",
      });
      expect(res?.status).toBe("QUALIFIED");
      const tx = (prisma as unknown as { __tx: { customerProfile: { update: ReturnType<typeof vi.fn> } } }).__tx;
      expect(tx.customerProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            referralCreditBalance: { increment: 20 },
          }),
        }),
      );
    });
  });
});
