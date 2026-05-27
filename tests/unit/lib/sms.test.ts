import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- mocks --------------------------------------------------------------
const messagesCreate = vi.fn();
vi.mock("twilio", () => ({
  default: () => ({ messages: { create: (...a: unknown[]) => messagesCreate(...a) } }),
}));

const getString = vi.fn();
const getSecret = vi.fn();
vi.mock("@/lib/integration-config", () => ({
  getString: (...a: unknown[]) => getString(...a),
  getSecret: (...a: unknown[]) => getSecret(...a),
}));

const recordTwilioSend = vi.fn();
vi.mock("@/server/services/twilio-cost", () => ({
  recordTwilioSend: (...a: unknown[]) => recordTwilioSend(...a),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// configure() wires the integration-config resolver per test.
function configure({
  sid = "AC123",
  token = "tok",
  from = "+61400000000",
  appUrl = null as string | null,
} = {}) {
  getString.mockImplementation(async (key: string) => {
    if (key === "integration:twilio:accountSid") return sid;
    if (key === "integration:twilio:fromNumber") return from;
    if (key === "integration:app:publicUrl") return appUrl;
    return null;
  });
  getSecret.mockImplementation(async () => token);
}

beforeEach(() => {
  vi.clearAllMocks();
  messagesCreate.mockResolvedValue({ sid: "SM1", status: "queued", numSegments: "1", price: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("normaliseAuPhone", () => {
  it("converts 04xx to +61", async () => {
    const { normaliseAuPhone } = await import("@/lib/sms");
    expect(normaliseAuPhone("0412 345 678")).toBe("+61412345678");
  });
  it("leaves +61 numbers unchanged", async () => {
    const { normaliseAuPhone } = await import("@/lib/sms");
    expect(normaliseAuPhone("+61412345678")).toBe("+61412345678");
  });
});

describe("sendSms — provider configured", () => {
  it("sends to the real recipient when no redirect is set", async () => {
    configure();
    const { sendSms } = await import("@/lib/sms");
    const res = await sendSms({ to: "0412345678", body: "hello" });
    expect(res.via).toBe("twilio");
    expect(messagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ to: "+61412345678", body: "hello" }),
    );
  });

  it("redirects to the dev number and annotates the body when SMS_DEV_REDIRECT_TO is set (non-prod)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SMS_DEV_REDIRECT_TO", "0499999999");
    configure();
    const { sendSms } = await import("@/lib/sms");
    await sendSms({ to: "0412345678", body: "hello" });
    const arg = messagesCreate.mock.calls[0]![0];
    expect(arg.to).toBe("+61499999999");
    expect(arg.body).toContain("+61412345678"); // intended recipient surfaced
    expect(arg.body).toContain("hello");
  });

  it("ignores the redirect in production — sends to the real recipient", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SMS_DEV_REDIRECT_TO", "0499999999");
    configure();
    const { sendSms } = await import("@/lib/sms");
    await sendSms({ to: "0412345678", body: "hello" });
    expect(messagesCreate.mock.calls[0]![0].to).toBe("+61412345678");
  });
});

describe("sendSms — provider not configured", () => {
  it("falls back to console without throwing", async () => {
    getString.mockResolvedValue(null);
    getSecret.mockResolvedValue(null);
    const { sendSms } = await import("@/lib/sms");
    const res = await sendSms({ to: "0412345678", body: "hello" });
    expect(res.via).toBe("console");
    expect(messagesCreate).not.toHaveBeenCalled();
  });
});
