import { describe, it, expect, vi, beforeEach } from "vitest";

const settingsFindMany = vi.fn();
const userFindUnique = vi.fn();
const notificationCreate = vi.fn();
const communicationLogCreate = vi.fn();
const invoiceFindUnique = vi.fn();
const adjustmentNoteFindUnique = vi.fn();
const rentalAgreementFindUnique = vi.fn();
const returnAssessmentFindUnique = vi.fn();
const paymentFindUnique = vi.fn();
const sendEmailSpy = vi.fn();
const sendSmsSpy = vi.fn();
const sendPushToUserSpy = vi.fn();
const downloadFileSpy = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    systemSetting: { findMany: (...a: unknown[]) => settingsFindMany(...a), findUnique: vi.fn() },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
    notification: { create: (...a: unknown[]) => notificationCreate(...a) },
    communicationLog: { create: (...a: unknown[]) => communicationLogCreate(...a) },
    invoice: { findUnique: (...a: unknown[]) => invoiceFindUnique(...a) },
    adjustmentNote: { findUnique: (...a: unknown[]) => adjustmentNoteFindUnique(...a) },
    rentalAgreement: { findUnique: (...a: unknown[]) => rentalAgreementFindUnique(...a) },
    returnAssessment: { findUnique: (...a: unknown[]) => returnAssessmentFindUnique(...a) },
    payment: { findUnique: (...a: unknown[]) => paymentFindUnique(...a) },
  },
}));

vi.mock("@/lib/email", () => ({
  sendEmail: (...a: unknown[]) => sendEmailSpy(...a),
  htmlToText: (s: string) => s,
}));
vi.mock("@/lib/sms", () => ({
  sendSms: (...a: unknown[]) => sendSmsSpy(...a),
}));
vi.mock("@/lib/push", () => ({
  sendPushToUser: (...a: unknown[]) => sendPushToUserSpy(...a),
}));
vi.mock("@/lib/storage", () => ({
  downloadFile: (...a: unknown[]) => downloadFileSpy(...a),
}));

// consent gate passes through by default — we're testing the admin pause gate,
// not consent logic.
vi.mock("@/server/services/consent", () => ({
  canSend: async () => ({ allowed: true }),
  categoryForType: () => "TRANSACTIONAL",
}));

beforeEach(() => {
  settingsFindMany.mockReset();
  userFindUnique.mockReset();
  notificationCreate.mockReset();
  communicationLogCreate.mockReset();
  invoiceFindUnique.mockReset();
  adjustmentNoteFindUnique.mockReset();
  rentalAgreementFindUnique.mockReset();
  returnAssessmentFindUnique.mockReset();
  paymentFindUnique.mockReset();
  sendEmailSpy.mockReset();
  sendSmsSpy.mockReset();
  sendPushToUserSpy.mockReset();
  downloadFileSpy.mockReset();

  userFindUnique.mockResolvedValue({ id: "u1", email: "a@b.com", phone: "+61400000000" });
  notificationCreate.mockResolvedValue({ id: "n1" });
  communicationLogCreate.mockResolvedValue({ id: "c1" });
  sendEmailSpy.mockResolvedValue({ id: "resend_123" });
  sendSmsSpy.mockResolvedValue({ sid: "twilio_123" });
  sendPushToUserSpy.mockResolvedValue(0);
});

describe("sendNotification admin-pause gate", () => {
  it("suppresses every channel when pauseAll=true and never calls providers", async () => {
    settingsFindMany.mockResolvedValue([{ key: "notification.pauseAll", value: true }]);
    const { sendNotification } = await import("@/server/services/notification-sender");

    const res = await sendNotification({
      userId: "u1",
      type: "BOOKING_CONFIRMATION",
      channels: ["EMAIL", "SMS"],
      body: "hi",
    });

    expect(sendEmailSpy).not.toHaveBeenCalled();
    expect(sendSmsSpy).not.toHaveBeenCalled();
    expect(res.results.every((r) => r.status === "SUPPRESSED" && r.reason === "paused")).toBe(true);

    const statuses = notificationCreate.mock.calls.map((c) => (c[0] as { data: { status: string } }).data.status);
    expect(statuses).toEqual(["SUPPRESSED", "SUPPRESSED"]);

    const logErrors = communicationLogCreate.mock.calls.map(
      (c) => (c[0] as { data: { errorMessage: string } }).data.errorMessage,
    );
    expect(logErrors).toEqual(["SUPPRESSED:paused", "SUPPRESSED:paused"]);
  });

  it("suppresses only the disabled channel when one per-channel toggle is off", async () => {
    settingsFindMany.mockResolvedValue([
      { key: "notification.enableEmail", value: false },
      // SMS stays enabled (default true)
    ]);
    const { sendNotification } = await import("@/server/services/notification-sender");

    const res = await sendNotification({
      userId: "u1",
      type: "BOOKING_CONFIRMATION",
      channels: ["EMAIL", "SMS"],
      body: "hi",
    });

    expect(sendEmailSpy).not.toHaveBeenCalled();
    expect(sendSmsSpy).toHaveBeenCalledTimes(1);

    const email = res.results.find((r) => r.channel === "EMAIL");
    const sms = res.results.find((r) => r.channel === "SMS");
    expect(email).toMatchObject({ status: "SUPPRESSED", reason: "channel_disabled" });
    expect(sms).toMatchObject({ status: "SENT" });
  });

  it("passes through when nothing is paused or disabled", async () => {
    settingsFindMany.mockResolvedValue([]);
    const { sendNotification } = await import("@/server/services/notification-sender");

    const res = await sendNotification({
      userId: "u1",
      type: "BOOKING_CONFIRMATION",
      channels: ["EMAIL"],
      body: "hi",
    });

    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(res.results[0]).toMatchObject({ status: "SENT", providerMessageId: "resend_123" });
  });
});

describe("sendNotification attachment resolution", () => {
  beforeEach(() => {
    settingsFindMany.mockResolvedValue([]);
  });

  it("resolves an invoice AttachmentRef to a PDF buffer with the correct filename", async () => {
    invoiceFindUnique.mockResolvedValue({
      invoiceNumber: "INV-2026-000123",
      pdfKey: "invoices/b1/INV-2026-000123.pdf",
    });
    const buf = Buffer.from("INVOICE-PDF");
    downloadFileSpy.mockResolvedValue(buf);

    const { sendNotification } = await import("@/server/services/notification-sender");
    await sendNotification({
      userId: "u1",
      type: "BOOKING_CONFIRMATION",
      channels: ["EMAIL"],
      body: "hi",
      attachments: [{ kind: "invoice", invoiceId: "inv_1" }],
    });

    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    const sent = sendEmailSpy.mock.calls[0]![0] as {
      attachments: Array<{ filename: string; content: Buffer }>;
    };
    expect(sent.attachments).toHaveLength(1);
    expect(sent.attachments[0]!.filename).toBe("tax-invoice-INV-2026-000123.pdf");
    expect(sent.attachments[0]!.content.toString()).toBe("INVOICE-PDF");
  });

  it("labels DECREASE adjustment notes as 'credit-note' and INCREASE as 'debit-note'", async () => {
    adjustmentNoteFindUnique.mockResolvedValueOnce({
      adjustmentNumber: "ADJ-2026-000001",
      pdfKey: "adjustment-notes/b1/ADJ-2026-000001.pdf",
      type: "DECREASE",
    });
    downloadFileSpy.mockResolvedValue(Buffer.from("PDF"));

    const { sendNotification } = await import("@/server/services/notification-sender");
    await sendNotification({
      userId: "u1",
      type: "ADJUSTMENT_NOTE_ISSUED",
      channels: ["EMAIL"],
      body: "hi",
      attachments: [{ kind: "adjustment-note", adjustmentNoteId: "adj_1" }],
    });
    const sent1 = sendEmailSpy.mock.calls[0]![0] as { attachments: Array<{ filename: string }> };
    expect(sent1.attachments[0]!.filename).toBe("credit-note-ADJ-2026-000001.pdf");

    sendEmailSpy.mockClear();
    adjustmentNoteFindUnique.mockResolvedValueOnce({
      adjustmentNumber: "ADJ-2026-000002",
      pdfKey: "adjustment-notes/b1/ADJ-2026-000002.pdf",
      type: "INCREASE",
    });
    await sendNotification({
      userId: "u1",
      type: "ADJUSTMENT_NOTE_ISSUED",
      channels: ["EMAIL"],
      body: "hi",
      attachments: [{ kind: "adjustment-note", adjustmentNoteId: "adj_2" }],
    });
    const sent2 = sendEmailSpy.mock.calls[0]![0] as { attachments: Array<{ filename: string }> };
    expect(sent2.attachments[0]!.filename).toBe("debit-note-ADJ-2026-000002.pdf");
  });

  it("drops attachments that fail to download but still ships the email body", async () => {
    invoiceFindUnique.mockResolvedValue({
      invoiceNumber: "INV-2026-000999",
      pdfKey: "invoices/b1/INV-2026-000999.pdf",
    });
    downloadFileSpy.mockRejectedValue(new Error("S3 timeout"));

    const { sendNotification } = await import("@/server/services/notification-sender");
    const res = await sendNotification({
      userId: "u1",
      type: "BOOKING_CONFIRMATION",
      channels: ["EMAIL"],
      body: "hi",
      attachments: [{ kind: "invoice", invoiceId: "inv_1" }],
    });

    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    const sent = sendEmailSpy.mock.calls[0]![0] as { attachments: Array<unknown> };
    // Failed download → dropped from the list, body still ships.
    expect(sent.attachments).toEqual([]);
    expect(res.results[0]).toMatchObject({ status: "SENT" });
  });

  it("never resolves attachments for non-EMAIL channels (no S3 round-trip)", async () => {
    invoiceFindUnique.mockResolvedValue({
      invoiceNumber: "INV-2026-000123",
      pdfKey: "invoices/b1/INV-2026-000123.pdf",
    });
    downloadFileSpy.mockResolvedValue(Buffer.from("PDF"));

    const { sendNotification } = await import("@/server/services/notification-sender");
    await sendNotification({
      userId: "u1",
      type: "BOOKING_CONFIRMATION",
      channels: ["SMS"],
      body: "hi",
      attachments: [{ kind: "invoice", invoiceId: "inv_1" }],
    });

    // SMS channel should not have triggered the storage download.
    expect(downloadFileSpy).not.toHaveBeenCalled();
    expect(invoiceFindUnique).not.toHaveBeenCalled();
    expect(sendSmsSpy).toHaveBeenCalledTimes(1);
  });
});
