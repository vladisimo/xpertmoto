import { describe, it, expect } from "vitest";
import { resolveCallbackUrl } from "@/components/auth/callback-url";

/**
 * NT-007 / frontend-test-findings #5. The login screens carry the requested
 * deep-link through sign-in via `?callbackUrl=`; the param is URL-supplied,
 * so the resolver is the only thing standing between it and an open
 * redirect.
 */
describe("resolveCallbackUrl", () => {
  it("honours a same-origin relative path", () => {
    expect(resolveCallbackUrl("/booking", "/portal-select")).toBe("/booking");
  });

  it("keeps the query string and hash of a relative path", () => {
    expect(
      resolveCallbackUrl("/staff/bookings?tab=today#row-3", "/dashboard"),
    ).toBe("/staff/bookings?tab=today#row-3");
  });

  it("falls back when the param is missing", () => {
    expect(resolveCallbackUrl(null, "/portal-select")).toBe("/portal-select");
    expect(resolveCallbackUrl(undefined, "/dashboard")).toBe("/dashboard");
    expect(resolveCallbackUrl("", "/dashboard")).toBe("/dashboard");
  });

  it("rejects absolute URLs", () => {
    expect(resolveCallbackUrl("https://evil.example/pwn", "/dashboard")).toBe(
      "/dashboard",
    );
    expect(resolveCallbackUrl("http://evil.example", "/dashboard")).toBe(
      "/dashboard",
    );
    expect(resolveCallbackUrl("javascript:alert(1)", "/dashboard")).toBe(
      "/dashboard",
    );
  });

  it("rejects protocol-relative URLs", () => {
    expect(resolveCallbackUrl("//evil.example/pwn", "/portal-select")).toBe(
      "/portal-select",
    );
    // Browsers normalise a backslash to a slash, so this is protocol-relative too.
    expect(resolveCallbackUrl("/\\evil.example", "/portal-select")).toBe(
      "/portal-select",
    );
  });

  it("rejects paths carrying URL-stripped control characters", () => {
    // "/\t/evil.example" collapses to "//evil.example" once the browser
    // strips the tab.
    expect(resolveCallbackUrl("/\t/evil.example", "/dashboard")).toBe(
      "/dashboard",
    );
    expect(resolveCallbackUrl("/\n//evil.example", "/dashboard")).toBe(
      "/dashboard",
    );
  });

  it("rejects host-relative values with no leading slash", () => {
    expect(resolveCallbackUrl("booking", "/dashboard")).toBe("/dashboard");
    expect(resolveCallbackUrl(" /booking", "/dashboard")).toBe("/dashboard");
  });
});
