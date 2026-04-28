import { describe, expect, test } from "vitest";
import { _internal } from "@/server/services/document-extract";

describe("detectMediaType", () => {
  test("PNG signature", () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(_internal.detectMediaType(buf)).toBe("image/png");
  });
  test("GIF signature", () => {
    const buf = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    expect(_internal.detectMediaType(buf)).toBe("image/gif");
  });
  test("WebP RIFF signature", () => {
    const buf = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00]);
    expect(_internal.detectMediaType(buf)).toBe("image/webp");
  });
  test("unknown header falls back to JPEG", () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    expect(_internal.detectMediaType(buf)).toBe("image/jpeg");
  });
});

describe("parseLooseDate", () => {
  test("ISO YYYY-MM-DD", () => {
    const d = _internal.parseLooseDate("1990-06-15");
    expect(d).toBeInstanceOf(Date);
    expect(d?.toISOString().startsWith("1990-06-15")).toBe(true);
  });
  test("Australian DD/MM/YYYY", () => {
    const d = _internal.parseLooseDate("15/06/1990");
    expect(d?.toISOString().startsWith("1990-06-15")).toBe(true);
  });
  test("two-digit year expands to 2000+", () => {
    const d = _internal.parseLooseDate("15/06/90");
    expect(d?.toISOString().startsWith("2090-06-15")).toBe(true);
  });
  test("unparseable returns undefined", () => {
    expect(_internal.parseLooseDate("not a date")).toBeUndefined();
    expect(_internal.parseLooseDate(undefined)).toBeUndefined();
    expect(_internal.parseLooseDate("")).toBeUndefined();
  });
});

describe("getProvider", () => {
  test("returns null when no key is set", () => {
    const a = process.env.ANTHROPIC_API_KEY;
    const o = process.env.OPENROUTER_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      expect(_internal.getProvider()).toBeNull();
    } finally {
      if (a) process.env.ANTHROPIC_API_KEY = a;
      if (o) process.env.OPENROUTER_API_KEY = o;
    }
  });

  test("prefers OpenRouter when both keys are set", () => {
    const a = process.env.ANTHROPIC_API_KEY;
    const o = process.env.OPENROUTER_API_KEY;
    const forced = process.env.DOCUMENT_EXTRACT_PROVIDER;
    process.env.ANTHROPIC_API_KEY = "ant-test";
    process.env.OPENROUTER_API_KEY = "or-test";
    delete process.env.DOCUMENT_EXTRACT_PROVIDER;
    // Also clear SUPPORT_AI_PROVIDER so this test is deterministic
    const support = process.env.SUPPORT_AI_PROVIDER;
    delete process.env.SUPPORT_AI_PROVIDER;
    try {
      const p = _internal.getProvider();
      expect(p?.kind).toBe("openrouter");
      expect(p?.model).toContain("claude");
    } finally {
      if (a) process.env.ANTHROPIC_API_KEY = a;
      else delete process.env.ANTHROPIC_API_KEY;
      if (o) process.env.OPENROUTER_API_KEY = o;
      else delete process.env.OPENROUTER_API_KEY;
      if (forced) process.env.DOCUMENT_EXTRACT_PROVIDER = forced;
      if (support) process.env.SUPPORT_AI_PROVIDER = support;
    }
  });

  test("falls back to Anthropic when only that key is set", () => {
    const a = process.env.ANTHROPIC_API_KEY;
    const o = process.env.OPENROUTER_API_KEY;
    process.env.ANTHROPIC_API_KEY = "ant-test";
    delete process.env.OPENROUTER_API_KEY;
    try {
      const p = _internal.getProvider();
      expect(p?.kind).toBe("anthropic");
    } finally {
      if (a) process.env.ANTHROPIC_API_KEY = a;
      else delete process.env.ANTHROPIC_API_KEY;
      if (o) process.env.OPENROUTER_API_KEY = o;
    }
  });
});
