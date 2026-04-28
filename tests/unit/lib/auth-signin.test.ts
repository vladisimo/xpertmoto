import { describe, expect, test, vi } from "vitest";
import {
  evaluateSignIn,
  SignInErrorCodes,
  type SignInDeps,
  type SignInUser,
} from "@/lib/auth-signin";

function makeDeps(overrides: Partial<SignInDeps> = {}): SignInDeps {
  return {
    findUserByEmailCI: vi.fn(async () => null),
    writeAudit: vi.fn(async () => {}),
    fetchGithubEmails: vi.fn(async () => []),
    oauthAllowedForBackOffice: vi.fn(async () => true),
    ...overrides,
  };
}

function customer(partial: Partial<SignInUser> = {}): SignInUser {
  return {
    id: "u_1",
    role: "CUSTOMER",
    status: "ACTIVE",
    deletedAt: null,
    ...partial,
  };
}

describe("evaluateSignIn — short-circuits", () => {
  test("credentials provider short-circuits to true", async () => {
    const findUser = vi.fn();
    const result = await evaluateSignIn({
      provider: "credentials",
      email: "whatever",
      profile: undefined,
      accessToken: null,
      deps: makeDeps({ findUserByEmailCI: findUser }),
    });
    expect(result).toBe(true);
    expect(findUser).not.toHaveBeenCalled();
  });

  test("impersonate provider short-circuits to true", async () => {
    const result = await evaluateSignIn({
      provider: "impersonate",
      email: null,
      profile: undefined,
      accessToken: null,
      deps: makeDeps(),
    });
    expect(result).toBe(true);
  });

  test("unknown provider returns false", async () => {
    const result = await evaluateSignIn({
      provider: "facebook",
      email: "a@b.com",
      profile: { email_verified: true },
      accessToken: null,
      deps: makeDeps(),
    });
    expect(result).toBe(false);
  });

  test("undefined provider returns false", async () => {
    const result = await evaluateSignIn({
      provider: undefined,
      email: "a@b.com",
      profile: undefined,
      accessToken: null,
      deps: makeDeps(),
    });
    expect(result).toBe(false);
  });
});

describe("evaluateSignIn — nodemailer", () => {
  test("nodemailer with no existing user allowed (first-time)", async () => {
    const result = await evaluateSignIn({
      provider: "nodemailer",
      email: "new@user.com",
      profile: undefined,
      accessToken: null,
      deps: makeDeps({ findUserByEmailCI: async () => null }),
    });
    expect(result).toBe(true);
  });

  test("nodemailer blocks soft-deleted users", async () => {
    const result = await evaluateSignIn({
      provider: "nodemailer",
      email: "a@b.com",
      profile: undefined,
      accessToken: null,
      deps: makeDeps({
        findUserByEmailCI: async () => customer({ deletedAt: new Date() }),
      }),
    });
    expect(result).toBe(false);
  });

  test("nodemailer blocks non-ACTIVE users", async () => {
    const result = await evaluateSignIn({
      provider: "nodemailer",
      email: "a@b.com",
      profile: undefined,
      accessToken: null,
      deps: makeDeps({
        findUserByEmailCI: async () => customer({ status: "SUSPENDED" }),
      }),
    });
    expect(result).toBe(false);
  });

  test("nodemailer with missing email returns false", async () => {
    const result = await evaluateSignIn({
      provider: "nodemailer",
      email: null,
      profile: undefined,
      accessToken: null,
      deps: makeDeps(),
    });
    expect(result).toBe(false);
  });
});

describe("evaluateSignIn — Google OAuth", () => {
  test("existing CUSTOMER, email_verified=true → allowed + audit written", async () => {
    const writeAudit = vi.fn(async () => {});
    const findUser = vi.fn(async () => customer());
    const result = await evaluateSignIn({
      provider: "google",
      email: "v@b.com",
      profile: { email_verified: true },
      accessToken: null,
      deps: makeDeps({ findUserByEmailCI: findUser, writeAudit }),
    });
    expect(result).toBe(true);
    expect(writeAudit).toHaveBeenCalledWith({
      userId: "u_1",
      action: "auth.oauth.linked_existing_user",
      provider: "google",
      providerEmail: "v@b.com",
    });
  });

  test("email_verified=false → redirect to OAuthEmailUnverified (no audit, no DB lookup)", async () => {
    const findUser = vi.fn(async () => customer());
    const writeAudit = vi.fn(async () => {});
    const result = await evaluateSignIn({
      provider: "google",
      email: "v@b.com",
      profile: { email_verified: false },
      accessToken: null,
      deps: makeDeps({ findUserByEmailCI: findUser, writeAudit }),
    });
    expect(result).toBe(`/login?error=${SignInErrorCodes.EmailUnverified}`);
    expect(findUser).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  test("missing/empty email → redirect to OAuthNoEmail", async () => {
    const result = await evaluateSignIn({
      provider: "google",
      email: "",
      profile: { email_verified: true },
      accessToken: null,
      deps: makeDeps(),
    });
    expect(result).toBe(`/login?error=${SignInErrorCodes.NoEmail}`);
  });

  test("existing STAFF, OAuth allowed for back-office (default) → allowed + audit", async () => {
    const writeAudit = vi.fn(async () => {});
    const result = await evaluateSignIn({
      provider: "google",
      email: "staff@b.com",
      profile: { email_verified: true },
      accessToken: null,
      deps: makeDeps({
        findUserByEmailCI: async () => customer({ id: "u_staff", role: "STAFF" }),
        writeAudit,
      }),
    });
    expect(result).toBe(true);
    expect(writeAudit).toHaveBeenCalledWith({
      userId: "u_staff",
      action: "auth.oauth.linked_existing_user",
      provider: "google",
      providerEmail: "staff@b.com",
    });
  });

  test("existing ADMIN, OAuth allowed for back-office (default) → allowed + audit", async () => {
    const writeAudit = vi.fn(async () => {});
    const result = await evaluateSignIn({
      provider: "google",
      email: "admin@b.com",
      profile: { email_verified: true },
      accessToken: null,
      deps: makeDeps({
        findUserByEmailCI: async () => customer({ id: "u_admin", role: "ADMIN" }),
        writeAudit,
      }),
    });
    expect(result).toBe(true);
    expect(writeAudit).toHaveBeenCalledWith({
      userId: "u_admin",
      action: "auth.oauth.linked_existing_user",
      provider: "google",
      providerEmail: "admin@b.com",
    });
  });

  test("existing SUPER_ADMIN, OAuth allowed for back-office (default) → allowed", async () => {
    const result = await evaluateSignIn({
      provider: "google",
      email: "s@b.com",
      profile: { email_verified: true },
      accessToken: null,
      deps: makeDeps({
        findUserByEmailCI: async () => customer({ role: "SUPER_ADMIN" }),
      }),
    });
    expect(result).toBe(true);
  });

  test("existing STAFF, OAuth disabled for back-office → OAuthDisabledForBackOffice", async () => {
    const result = await evaluateSignIn({
      provider: "google",
      email: "staff@b.com",
      profile: { email_verified: true },
      accessToken: null,
      deps: makeDeps({
        findUserByEmailCI: async () => customer({ role: "STAFF" }),
        oauthAllowedForBackOffice: async () => false,
      }),
    });
    expect(result).toBe(`/login?error=${SignInErrorCodes.DisabledForBackOffice}`);
  });

  test("existing ADMIN, OAuth disabled for back-office → OAuthDisabledForBackOffice", async () => {
    const result = await evaluateSignIn({
      provider: "google",
      email: "admin@b.com",
      profile: { email_verified: true },
      accessToken: null,
      deps: makeDeps({
        findUserByEmailCI: async () => customer({ role: "ADMIN" }),
        oauthAllowedForBackOffice: async () => false,
      }),
    });
    expect(result).toBe(`/login?error=${SignInErrorCodes.DisabledForBackOffice}`);
  });

  test("CUSTOMER role is never gated by oauthAllowedForBackOffice", async () => {
    const oauthAllowedForBackOffice = vi.fn(async () => false);
    const result = await evaluateSignIn({
      provider: "google",
      email: "v@b.com",
      profile: { email_verified: true },
      accessToken: null,
      deps: makeDeps({
        findUserByEmailCI: async () => customer({ role: "CUSTOMER" }),
        oauthAllowedForBackOffice,
      }),
    });
    expect(result).toBe(true);
    // Even reading the setting is unnecessary for customers, but if the
    // implementation does consult it, that's still fine — the contract is
    // "customer is allowed regardless of the flag".
  });

  test("SUSPENDED customer → redirect to AccountUnavailable", async () => {
    const result = await evaluateSignIn({
      provider: "google",
      email: "v@b.com",
      profile: { email_verified: true },
      accessToken: null,
      deps: makeDeps({
        findUserByEmailCI: async () => customer({ status: "SUSPENDED" }),
      }),
    });
    expect(result).toBe(`/login?error=${SignInErrorCodes.AccountUnavailable}`);
  });

  test("BANNED customer → redirect to AccountUnavailable", async () => {
    const result = await evaluateSignIn({
      provider: "google",
      email: "v@b.com",
      profile: { email_verified: true },
      accessToken: null,
      deps: makeDeps({
        findUserByEmailCI: async () => customer({ status: "BANNED" }),
      }),
    });
    expect(result).toBe(`/login?error=${SignInErrorCodes.AccountUnavailable}`);
  });

  test("soft-deleted customer → redirect to AccountUnavailable", async () => {
    const result = await evaluateSignIn({
      provider: "google",
      email: "v@b.com",
      profile: { email_verified: true },
      accessToken: null,
      deps: makeDeps({
        findUserByEmailCI: async () => customer({ deletedAt: new Date() }),
      }),
    });
    expect(result).toBe(`/login?error=${SignInErrorCodes.AccountUnavailable}`);
  });

  test("no existing user + verified → allowed (first-time signup)", async () => {
    const writeAudit = vi.fn(async () => {});
    const result = await evaluateSignIn({
      provider: "google",
      email: "brand-new@b.com",
      profile: { email_verified: true },
      accessToken: null,
      deps: makeDeps({
        findUserByEmailCI: async () => null,
        writeAudit,
      }),
    });
    expect(result).toBe(true);
    // No "linked_existing_user" audit for first-time signup — the
    // NextAuth events pipeline handles the signup row.
    expect(writeAudit).not.toHaveBeenCalled();
  });

  test("DB lookup runs with lowercased+trimmed email", async () => {
    const findUser = vi.fn(async () => null);
    await evaluateSignIn({
      provider: "google",
      email: "  Vlad.ME@Gmail.COM ",
      profile: { email_verified: true },
      accessToken: null,
      deps: makeDeps({ findUserByEmailCI: findUser }),
    });
    expect(findUser).toHaveBeenCalledWith("vlad.me@gmail.com");
  });
});

describe("evaluateSignIn — GitHub OAuth", () => {
  test("primary+verified email match → allowed", async () => {
    const fetchGithubEmails = vi.fn(async () => [
      { email: "me@b.com", primary: true, verified: true },
    ]);
    const result = await evaluateSignIn({
      provider: "github",
      email: "me@b.com",
      profile: {},
      accessToken: "gho_test",
      deps: makeDeps({
        findUserByEmailCI: async () => null,
        fetchGithubEmails,
      }),
    });
    expect(result).toBe(true);
    expect(fetchGithubEmails).toHaveBeenCalledWith("gho_test");
  });

  test("primary unverified → rejected", async () => {
    const result = await evaluateSignIn({
      provider: "github",
      email: "me@b.com",
      profile: {},
      accessToken: "gho_test",
      deps: makeDeps({
        fetchGithubEmails: async () => [
          { email: "me@b.com", primary: true, verified: false },
        ],
      }),
    });
    expect(result).toBe(`/login?error=${SignInErrorCodes.EmailUnverified}`);
  });
});

describe("evaluateSignIn — Microsoft Entra ID OAuth", () => {
  test("xms_edov=true → allowed", async () => {
    const result = await evaluateSignIn({
      provider: "microsoft-entra-id",
      email: "me@outlook.com",
      profile: { xms_edov: true },
      accessToken: null,
      deps: makeDeps({ findUserByEmailCI: async () => null }),
    });
    expect(result).toBe(true);
  });

  test("xms_edov missing → rejected with OAuthEmailUnverified", async () => {
    const result = await evaluateSignIn({
      provider: "microsoft-entra-id",
      email: "me@outlook.com",
      profile: {},
      accessToken: null,
      deps: makeDeps({ findUserByEmailCI: async () => null }),
    });
    expect(result).toBe(`/login?error=${SignInErrorCodes.EmailUnverified}`);
  });
});

describe("evaluateSignIn — Apple OAuth", () => {
  test("email_verified === true → allowed", async () => {
    const result = await evaluateSignIn({
      provider: "apple",
      email: "me@icloud.com",
      profile: { email_verified: true },
      accessToken: null,
      deps: makeDeps({ findUserByEmailCI: async () => null }),
    });
    expect(result).toBe(true);
  });

  test("email_verified === 'true' string form → allowed", async () => {
    const result = await evaluateSignIn({
      provider: "apple",
      email: "me@icloud.com",
      profile: { email_verified: "true" },
      accessToken: null,
      deps: makeDeps({ findUserByEmailCI: async () => null }),
    });
    expect(result).toBe(true);
  });
});
