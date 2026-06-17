import { describe, it, expect, afterEach, vi } from "vitest";
import { getSiteUrl, absoluteUrl } from "@/lib/seo/site-url";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getSiteUrl", () => {
  it("prefers NEXT_PUBLIC_APP_URL over the others", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://public.example.com");
    vi.stubEnv("APP_URL", "https://app.example.com");
    vi.stubEnv("AUTH_URL", "https://auth.example.com");
    expect(getSiteUrl()).toBe("https://public.example.com");
  });

  it("falls back to APP_URL then AUTH_URL when earlier ones are absent/blank", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("AUTH_URL", "https://auth.example.com");
    expect(getSiteUrl()).toBe("https://auth.example.com");
  });

  it("strips trailing slash / path / query via .origin", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.com/some/path?x=1");
    expect(getSiteUrl()).toBe("https://example.com");
  });

  it("falls back to localhost when nothing is set", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", undefined);
    vi.stubEnv("APP_URL", undefined);
    vi.stubEnv("AUTH_URL", undefined);
    expect(getSiteUrl()).toBe("http://localhost:3000");
  });

  it("falls back to localhost on a malformed URL", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "not a url");
    vi.stubEnv("APP_URL", undefined);
    vi.stubEnv("AUTH_URL", undefined);
    expect(getSiteUrl()).toBe("http://localhost:3000");
  });
});

describe("absoluteUrl", () => {
  it("joins a root-relative path onto the origin", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.com");
    expect(absoluteUrl("/fleet")).toBe("https://example.com/fleet");
  });

  it("adds a missing leading slash", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.com");
    expect(absoluteUrl("fleet")).toBe("https://example.com/fleet");
  });

  it("passes absolute URLs through untouched", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.com");
    expect(absoluteUrl("https://cdn.example.net/a.png")).toBe(
      "https://cdn.example.net/a.png",
    );
  });
});
