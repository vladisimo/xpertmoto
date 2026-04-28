import { describe, expect, test } from "vitest";

import {
  escapeHtml,
  extractPlaceholders,
  renderTemplate,
} from "@/server/trpc/router/communication";

describe("escapeHtml", () => {
  test("escapes the five XSS-relevant characters", () => {
    expect(escapeHtml(`<script>alert("x & y's")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x &amp; y&#39;s&quot;)&lt;/script&gt;",
    );
  });

  test("escapes `&` first so existing entity syntax round-trips", () => {
    // Without the correct ordering, `&lt;` becomes `&amp;lt;` then `&amp;amp;lt;`.
    expect(escapeHtml("A & B")).toBe("A &amp; B");
  });
});

describe("renderTemplate — plain text mode", () => {
  test("substitutes `{{name}}` with the supplied value", () => {
    expect(renderTemplate("Hi {{name}}", { name: "Alex" })).toBe("Hi Alex");
  });

  test("preserves HTML special characters in plain-text mode", () => {
    // In plain-text templates, values like `<` are literal — we want the
    // email to contain `<script>` verbatim, not `&lt;script&gt;`.
    expect(renderTemplate("> {{tag}}", { tag: "<b>" })).toBe("> <b>");
  });

  test("passes through unknown placeholders unchanged", () => {
    expect(renderTemplate("Hi {{missing}}", {})).toBe("Hi {{missing}}");
  });

  test("allows whitespace inside braces", () => {
    expect(renderTemplate("Hi {{  name  }}", { name: "Alex" })).toBe("Hi Alex");
  });
});

describe("renderTemplate — HTML mode", () => {
  test("HTML-escapes substituted values", () => {
    // A malicious variable value must not inject markup into the email.
    const result = renderTemplate(
      "<p>Hi {{name}}</p>",
      { name: "<script>alert(1)</script>" },
      "HTML",
    );
    expect(result).toBe("<p>Hi &lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });

  test("preserves author HTML around escaped values", () => {
    expect(
      renderTemplate("<strong>{{name}}</strong>", { name: "Jo" }, "HTML"),
    ).toBe("<strong>Jo</strong>");
  });

  test("triple-brace `{{{raw}}}` inserts the value without escaping", () => {
    // Used for admin-managed signature blocks or pre-rendered HTML fragments.
    const result = renderTemplate(
      "<p>Cheers,</p>{{{signature}}}",
      { signature: "<em>— Jo</em>" },
      "HTML",
    );
    expect(result).toBe("<p>Cheers,</p><em>— Jo</em>");
  });

  test("unknown triple-brace placeholder passes through untouched, not partially matched", () => {
    // If the two-pass implementation were naive, the inner `{{missing}}`
    // of a passed-through `{{{missing}}}` would get re-matched and
    // double-rendered. Guard against regression.
    expect(renderTemplate("x {{{missing}}} y", {}, "HTML")).toBe(
      "x {{{missing}}} y",
    );
  });

  test("double and triple braces coexist in the same template", () => {
    const result = renderTemplate(
      "<p>Hi {{name}},</p>{{{signature}}}",
      { name: "<b>Jo</b>", signature: "<em>— Jo</em>" },
      "HTML",
    );
    expect(result).toBe("<p>Hi &lt;b&gt;Jo&lt;/b&gt;,</p><em>— Jo</em>");
  });
});

describe("extractPlaceholders", () => {
  test("returns unique placeholder names from a template", () => {
    const names = extractPlaceholders(
      "Hi {{firstName}}, your {{bookingReference}} is ready. {{{signature}}}. {{firstName}} again.",
    );
    expect(names.sort()).toEqual(
      ["bookingReference", "firstName", "signature"].sort(),
    );
  });

  test("returns an empty array for a template with no placeholders", () => {
    expect(extractPlaceholders("Just a literal string.")).toEqual([]);
  });
});
