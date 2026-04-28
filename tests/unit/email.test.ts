import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { htmlToText } from "@/lib/email";

describe("htmlToText", () => {
  test("strips tags and preserves visible text", () => {
    expect(htmlToText("<p>Hi <strong>Alex</strong></p>")).toBe("Hi Alex");
  });

  test("converts `<br>` to newline", () => {
    expect(htmlToText("Line 1<br>Line 2<br/>Line 3")).toBe(
      "Line 1\nLine 2\nLine 3",
    );
  });

  test("drops `<style>` and `<script>` blocks entirely", () => {
    const html = `<style>body { color: red }</style><p>Hi</p><script>evil()</script>`;
    expect(htmlToText(html)).toBe("Hi");
  });

  test("decodes common HTML entities", () => {
    // These are produced by our own HTML-mode renderTemplate; the text
    // alternative must decode them back so the recipient sees the
    // original characters, not entity gibberish.
    expect(htmlToText("A &amp; B &lt;C&gt; &quot;D&quot; &#39;E&#39;"))
      .toBe(`A & B <C> "D" 'E'`);
  });

  test("renders list items with bullets and newlines", () => {
    const html = `<ul><li>one</li><li>two</li></ul>`;
    expect(htmlToText(html)).toBe("• one\n• two");
  });

  test("collapses runs of blank lines", () => {
    const html = `<p>A</p><p></p><p></p><p>B</p>`;
    expect(htmlToText(html)).toBe("A\n\nB");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Attachment plumbing — test that PDF buffers reach the provider, and that
// the 10 MB total cap drops oversized attachments rather than failing the
// send. The body still has to ship so the recipient at least learns the
// document exists.
// ───────────────────────────────────────────────────────────────────────────

const resendSendSpy = vi.fn();
const recordEmailSendSpy = vi.fn();

vi.mock("@/lib/integration-config", () => ({
  getString: vi.fn(async () => undefined),
  getSecret: vi.fn(async (key: string) =>
    key === "integration:resend:apiKey" ? "test-key" : undefined,
  ),
}));

vi.mock("@/lib/branding", () => ({
  getBranding: vi.fn(async () => ({ siteName: "Test Brand" })),
}));

vi.mock("@/server/services/email-cost", () => ({
  recordEmailSend: (...a: unknown[]) => recordEmailSendSpy(...a),
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: (payload: unknown) => resendSendSpy(payload),
    };
  },
}));

describe("sendEmail attachments", () => {
  beforeEach(() => {
    resendSendSpy.mockReset();
    recordEmailSendSpy.mockReset();
    resendSendSpy.mockResolvedValue({ data: { id: "msg_1" }, error: null });
    recordEmailSendSpy.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("passes attachments through to Resend as base64-encoded content", async () => {
    const { sendEmail } = await import("@/lib/email");
    const buf = Buffer.from("PDF-BODY");
    await sendEmail({
      to: "a@b.com",
      subject: "Test",
      html: "<p>hi</p>",
      attachments: [
        { filename: "tax-invoice-INV-1.pdf", content: buf, contentType: "application/pdf" },
      ],
    });
    expect(resendSendSpy).toHaveBeenCalledTimes(1);
    const sent = resendSendSpy.mock.calls[0]![0] as {
      attachments: Array<{ filename: string; content: string; contentType?: string }>;
    };
    expect(sent.attachments).toHaveLength(1);
    expect(sent.attachments[0]!.filename).toBe("tax-invoice-INV-1.pdf");
    expect(sent.attachments[0]!.content).toBe(buf.toString("base64"));
    expect(sent.attachments[0]!.contentType).toBe("application/pdf");
  });

  test("does not include an `attachments` key when the array is empty", async () => {
    const { sendEmail } = await import("@/lib/email");
    await sendEmail({ to: "a@b.com", subject: "Test", html: "<p>hi</p>" });
    const sent = resendSendSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent).not.toHaveProperty("attachments");
  });

  test("drops attachments that push the running total over the 10 MB cap", async () => {
    const { sendEmail } = await import("@/lib/email");
    const big = Buffer.alloc(8 * 1024 * 1024); // 8 MB
    const small = Buffer.alloc(512 * 1024); // 0.5 MB
    const huge = Buffer.alloc(5 * 1024 * 1024); // 5 MB — would push past 10 MB cap
    await sendEmail({
      to: "a@b.com",
      subject: "Test",
      html: "<p>hi</p>",
      attachments: [
        { filename: "big.pdf", content: big },
        { filename: "small.pdf", content: small },
        { filename: "huge.pdf", content: huge },
      ],
    });
    const sent = resendSendSpy.mock.calls[0]![0] as {
      attachments: Array<{ filename: string }>;
    };
    // big (8 MB) and small (0.5 MB) fit; huge (5 MB) gets dropped because
    // 8 + 0.5 + 5 = 13.5 MB > 10 MB cap. The body still ships.
    expect(sent.attachments.map((a) => a.filename)).toEqual(["big.pdf", "small.pdf"]);
    expect(resendSendSpy).toHaveBeenCalledTimes(1);
  });
});
