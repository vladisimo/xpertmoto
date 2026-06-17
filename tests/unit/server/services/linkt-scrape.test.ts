import { describe, it, expect } from "vitest";
import { classifyScrapeFailure, parseProxy } from "@/server/services/linkt-scrape";

describe("classifyScrapeFailure", () => {
  it("flags an Incapsula challenge resource as blocked", () => {
    const r = classifyScrapeFailure({
      url: "https://www.linkt.com.au/login",
      bodyText: "Request unsuccessful. Incapsula incident ID: 1234",
      html: "<html><head><script src='/_Incapsula_Resource?SWJIYLWA=1'></script></head></html>",
    });
    expect(r.kind).toBe("blocked");
  });

  it("flags an 'are you a human' interstitial as blocked", () => {
    const r = classifyScrapeFailure({
      url: "https://www.linkt.com.au/login",
      bodyText: "Are you a human? Please verify to continue.",
      html: "",
    });
    expect(r.kind).toBe("blocked");
  });

  it("treats a login-error toast as an auth failure", () => {
    const r = classifyScrapeFailure({
      url: "https://www.linkt.com.au/login",
      bodyText: "Sign in",
      html: "<html></html>",
      toastText: "The email or password is incorrect",
    });
    expect(r.kind).toBe("auth");
    expect(r.reason).toMatch(/incorrect/);
  });

  it("lets a block win over a toast when both are present", () => {
    const r = classifyScrapeFailure({
      url: "x",
      bodyText: "incapsula",
      html: "",
      toastText: "bad password",
    });
    expect(r.kind).toBe("blocked");
  });

  it("returns unknown when nothing matches (e.g. an unexpected page)", () => {
    const r = classifyScrapeFailure({
      url: "https://www.linkt.com.au/my-account",
      bodyText: "Welcome back",
      html: "<html><body>Welcome back</body></html>",
    });
    expect(r.kind).toBe("unknown");
  });
});

describe("parseProxy", () => {
  it("returns undefined for empty / whitespace input", () => {
    expect(parseProxy(undefined)).toBeUndefined();
    expect(parseProxy("   ")).toBeUndefined();
  });

  it("splits (url-decoded) credentials out of the proxy URL", () => {
    const p = parseProxy("http://user:p%40ss@host.example:8080");
    expect(p?.server).toBe("http://host.example:8080");
    expect(p?.username).toBe("user");
    expect(p?.password).toBe("p@ss");
  });

  it("handles a bare host:port proxy with no credentials", () => {
    const p = parseProxy("http://1.2.3.4:9000");
    expect(p?.server).toBe("http://1.2.3.4:9000");
    expect(p?.username).toBeUndefined();
    expect(p?.password).toBeUndefined();
  });
});
