import { describe, it, expect } from "vitest";
import { REPORT_CONFIGS, REPORT_CONFIG_BY_KEY, CATEGORY_ORDER } from "@/components/admin/report-configs";
import { getReport } from "@/lib/export/registry";

describe("REPORT_CONFIGS registry", () => {
  it("contains at least 20 reports", () => {
    expect(REPORT_CONFIGS.length).toBeGreaterThanOrEqual(20);
  });

  it("has no duplicate keys", () => {
    const keys = REPORT_CONFIGS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every key resolves to an entry in the export registry", () => {
    for (const cfg of REPORT_CONFIGS) {
      const registered = getReport(cfg.key);
      expect(registered, `missing export registration for ${cfg.key}`).toBeDefined();
    }
  });

  it("every config has required shape", () => {
    for (const cfg of REPORT_CONFIGS) {
      expect(cfg.title, `title missing on ${cfg.key}`).toBeTruthy();
      expect(cfg.description, `description missing on ${cfg.key}`).toBeTruthy();
      expect(cfg.columns.length, `columns empty on ${cfg.key}`).toBeGreaterThan(0);
      expect(typeof cfg.getRowId, `getRowId missing on ${cfg.key}`).toBe("function");
      expect(typeof cfg.useQuery, `useQuery missing on ${cfg.key}`).toBe("function");
      expect(CATEGORY_ORDER).toContain(cfg.category);
    }
  });

  it("REPORT_CONFIG_BY_KEY maps each config", () => {
    expect(Object.keys(REPORT_CONFIG_BY_KEY).length).toBe(REPORT_CONFIGS.length);
    for (const cfg of REPORT_CONFIGS) {
      expect(REPORT_CONFIG_BY_KEY[cfg.key]).toBe(cfg);
    }
  });

  it("covers every category", () => {
    const cats = new Set(REPORT_CONFIGS.map((c) => c.category));
    for (const cat of CATEGORY_ORDER) {
      expect(cats.has(cat), `no reports in category ${cat}`).toBe(true);
    }
  });
});
