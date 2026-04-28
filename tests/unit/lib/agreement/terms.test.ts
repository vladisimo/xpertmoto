import { describe, expect, it } from "vitest";
import { CURRENT_TERMS, TERMS_V2 } from "@/lib/agreement/terms";

describe("agreement terms module", () => {
  it("exports the current terms set", () => {
    expect(CURRENT_TERMS).toBe(TERMS_V2);
  });

  it("has a semver-like version and an effective date", () => {
    expect(CURRENT_TERMS.version).toMatch(/^\d+\.\d+$/);
    expect(Number.isFinite(Date.parse(CURRENT_TERMS.effective))).toBe(true);
  });

  it("contains at least 10 distinct sections with content", () => {
    expect(CURRENT_TERMS.sections.length).toBeGreaterThanOrEqual(10);
    for (const s of CURRENT_TERMS.sections) {
      expect(s.heading.length).toBeGreaterThan(0);
      expect(s.paragraphs.length).toBeGreaterThan(0);
      for (const p of s.paragraphs) {
        expect(p.length).toBeGreaterThan(10);
      }
    }
  });

  it("includes required hire-specific clauses", () => {
    const headings = CURRENT_TERMS.sections.map((s) => s.heading.toLowerCase()).join(" | ");
    expect(headings).toMatch(/licence/);
    expect(headings).toMatch(/bond/);
    expect(headings).toMatch(/insurance|damage/);
    expect(headings).toMatch(/cancellation/);
  });
});
