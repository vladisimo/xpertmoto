import { describe, expect, it, vi } from "vitest";

// The guard fires before any PDF work, so only branding needs mocking.
vi.mock("@/lib/branding", () => ({
  getBranding: vi.fn().mockResolvedValue({
    siteName: "Demo",
    legalName: "",
    abn: "",
  }),
}));

import { renderTaxInvoicePdf } from "@/lib/pdf/tax-invoice";
import { renderAdjustmentNotePdf } from "@/lib/pdf/adjustment-note";

describe("tax-document ABN guard (B5)", () => {
  it("refuses to render a tax invoice without org.legalName/org.abn", async () => {
    await expect(
      renderTaxInvoicePdf({} as Parameters<typeof renderTaxInvoicePdf>[0]),
    ).rejects.toThrow(/org\.legalName and org\.abn are not configured/);
  });

  it("refuses to render an adjustment note without org.legalName/org.abn", async () => {
    await expect(
      renderAdjustmentNotePdf({} as Parameters<typeof renderAdjustmentNotePdf>[0]),
    ).rejects.toThrow(/org\.legalName and org\.abn are not configured/);
  });
});
