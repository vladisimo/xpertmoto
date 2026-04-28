import { describe, expect, test, vi } from "vitest";
import {
  isOAuthEmailVerified,
  type GithubEmailEntry,
} from "@/lib/oauth-verification";

describe("isOAuthEmailVerified", () => {
  test("google: accepts email_verified === true", async () => {
    const result = await isOAuthEmailVerified({
      provider: "google",
      profile: { email_verified: true },
      accessToken: null,
      providerEmail: "a@b.com",
    });
    expect(result).toBe(true);
  });

  test("google: rejects email_verified === false", async () => {
    const result = await isOAuthEmailVerified({
      provider: "google",
      profile: { email_verified: false },
      accessToken: null,
      providerEmail: "a@b.com",
    });
    expect(result).toBe(false);
  });

  test("google: rejects missing email_verified claim", async () => {
    const result = await isOAuthEmailVerified({
      provider: "google",
      profile: {},
      accessToken: null,
      providerEmail: "a@b.com",
    });
    expect(result).toBe(false);
  });

  test("apple: accepts both boolean and string-'true' forms", async () => {
    const a = await isOAuthEmailVerified({
      provider: "apple",
      profile: { email_verified: true },
      accessToken: null,
      providerEmail: "a@b.com",
    });
    const b = await isOAuthEmailVerified({
      provider: "apple",
      profile: { email_verified: "true" },
      accessToken: null,
      providerEmail: "a@b.com",
    });
    expect(a).toBe(true);
    expect(b).toBe(true);
  });

  test("apple: rejects 'false' string and missing claim", async () => {
    const a = await isOAuthEmailVerified({
      provider: "apple",
      profile: { email_verified: "false" },
      accessToken: null,
      providerEmail: "a@b.com",
    });
    const b = await isOAuthEmailVerified({
      provider: "apple",
      profile: {},
      accessToken: null,
      providerEmail: "a@b.com",
    });
    expect(a).toBe(false);
    expect(b).toBe(false);
  });

  test("microsoft-entra-id: requires xms_edov === true", async () => {
    expect(
      await isOAuthEmailVerified({
        provider: "microsoft-entra-id",
        profile: { xms_edov: true },
        accessToken: null,
        providerEmail: "a@b.com",
      }),
    ).toBe(true);
    expect(
      await isOAuthEmailVerified({
        provider: "microsoft-entra-id",
        profile: { xms_edov: false },
        accessToken: null,
        providerEmail: "a@b.com",
      }),
    ).toBe(false);
    expect(
      await isOAuthEmailVerified({
        provider: "microsoft-entra-id",
        profile: {},
        accessToken: null,
        providerEmail: "a@b.com",
      }),
    ).toBe(false);
  });

  test("github: primary+verified match allowed", async () => {
    const fetcher = vi.fn(
      async (): Promise<GithubEmailEntry[]> => [
        { email: "other@x.com", primary: false, verified: true },
        { email: "ME@B.COM", primary: true, verified: true },
      ],
    );
    const result = await isOAuthEmailVerified({
      provider: "github",
      profile: {},
      accessToken: "gho_test",
      providerEmail: "me@b.com",
      fetchGithubEmails: fetcher,
    });
    expect(result).toBe(true);
    expect(fetcher).toHaveBeenCalledWith("gho_test");
  });

  test("github: primary but unverified rejected", async () => {
    const fetcher = async (): Promise<GithubEmailEntry[]> => [
      { email: "me@b.com", primary: true, verified: false },
    ];
    expect(
      await isOAuthEmailVerified({
        provider: "github",
        profile: {},
        accessToken: "t",
        providerEmail: "me@b.com",
        fetchGithubEmails: fetcher,
      }),
    ).toBe(false);
  });

  test("github: verified-but-not-primary rejected", async () => {
    const fetcher = async (): Promise<GithubEmailEntry[]> => [
      { email: "me@b.com", primary: false, verified: true },
    ];
    expect(
      await isOAuthEmailVerified({
        provider: "github",
        profile: {},
        accessToken: "t",
        providerEmail: "me@b.com",
        fetchGithubEmails: fetcher,
      }),
    ).toBe(false);
  });

  test("github: no access token rejected", async () => {
    const fetcher = vi.fn();
    expect(
      await isOAuthEmailVerified({
        provider: "github",
        profile: {},
        accessToken: null,
        providerEmail: "me@b.com",
        fetchGithubEmails: fetcher,
      }),
    ).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("github: fetcher throws → returns false (fails closed)", async () => {
    const fetcher = async (): Promise<GithubEmailEntry[]> => {
      throw new Error("network boom");
    };
    expect(
      await isOAuthEmailVerified({
        provider: "github",
        profile: {},
        accessToken: "t",
        providerEmail: "me@b.com",
        fetchGithubEmails: fetcher,
      }),
    ).toBe(false);
  });

  test("unknown provider rejected", async () => {
    expect(
      await isOAuthEmailVerified({
        provider: "facebook",
        profile: { email_verified: true },
        accessToken: null,
        providerEmail: "a@b.com",
      }),
    ).toBe(false);
  });
});
