import { describe, expect, test } from "vitest";

import { paragraphs, renderEmailShell, summaryTable } from "@/lib/email-shell";

describe("renderEmailShell", () => {
  test("includes the expected landmarks: logo, title, body slot, policy links, footer", () => {
    const html = renderEmailShell({
      title: "Hello",
      body: "<p>Body goes here.</p>",
    });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<meta name=\"viewport\"");
    expect(html).toContain("src=\"{{logoUrl}}\"");
    expect(html).toContain("alt=\"{{siteName}}\"");
    expect(html).toContain(">Hello</h1>");
    expect(html).toContain("<p>Body goes here.</p>");
    expect(html).toContain("href=\"{{termsUrl}}\"");
    expect(html).toContain("href=\"{{privacyUrl}}\"");
    expect(html).toContain("href=\"{{refundPolicyUrl}}\"");
    expect(html).toContain("href=\"{{supportUrl}}\"");
    expect(html).toContain("{{legalName}}");
    expect(html).toContain("ABN {{abn}}");
    expect(html).toContain("{{currentYear}}");
  });

  test("includes mobile @media query so phones get scaled-down layout", () => {
    const html = renderEmailShell({ body: "x" });
    expect(html).toContain("@media only screen and (max-width: 600px)");
  });

  test("CTA button renders with label and URL when provided", () => {
    const html = renderEmailShell({
      body: "x",
      cta: { label: "Book now", url: "https://example.com/book" },
    });
    expect(html).toContain("href=\"https://example.com/book\"");
    expect(html).toContain(">\n             Book now\n           </a>");
  });

  test("no CTA renders no button", () => {
    const html = renderEmailShell({ body: "x" });
    expect(html).not.toMatch(/padding:14px 28px/);
  });

  test("preheader text is present but hidden (max-height:0)", () => {
    const html = renderEmailShell({
      preheader: "Your booking is confirmed",
      body: "x",
    });
    expect(html).toContain("Your booking is confirmed");
    expect(html).toContain("max-height:0");
  });

  test("footer note renders when provided (e.g. unsubscribe link)", () => {
    const html = renderEmailShell({
      body: "x",
      footerNote: `<a href="{{unsubscribeUrl}}">Unsubscribe</a>`,
    });
    expect(html).toContain(`href="{{unsubscribeUrl}}"`);
  });
});

describe("paragraphs", () => {
  test("splits on blank lines into <p> blocks", () => {
    const html = paragraphs("First paragraph.\n\nSecond paragraph.");
    expect(html).toMatch(/^<p[^>]*>First paragraph\.<\/p><p[^>]*>Second paragraph\.<\/p>$/);
  });

  test("converts single newlines to <br/>", () => {
    const html = paragraphs("Line 1\nLine 2");
    expect(html).toContain("Line 1<br/>Line 2");
  });
});

describe("summaryTable", () => {
  test("renders label/value pairs as table rows", () => {
    const html = summaryTable([
      { label: "Reference", value: "SCT-1234" },
      { label: "Total", value: "A$99" },
    ]);
    expect(html).toContain("<table");
    expect(html).toContain(">Reference<");
    expect(html).toContain(">SCT-1234<");
    expect(html).toContain(">Total<");
    expect(html).toContain(">A$99<");
  });

  test("empty row list returns empty string", () => {
    expect(summaryTable([])).toBe("");
  });

  test("last row has no bottom border (no visible double-line against table frame)", () => {
    const html = summaryTable([
      { label: "A", value: "1" },
      { label: "B", value: "2" },
    ]);
    // The final row's two cells should NOT carry `border-bottom:1px solid`.
    // Split on `<tr>` and inspect the last row segment.
    const rows = html.split("<tr>").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("border-bottom:1px solid");
    expect(rows[1]).not.toContain("border-bottom:1px solid");
  });
});
