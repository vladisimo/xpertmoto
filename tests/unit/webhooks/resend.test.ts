import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";

const notificationUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const notificationFindFirst = vi.fn().mockResolvedValue(null);
const systemSettingFindUnique = vi.fn().mockResolvedValue(null);
const trackServerMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/prisma", () => ({
  prisma: {
    notification: { updateMany: notificationUpdateMany, findFirst: notificationFindFirst },
    systemSetting: { findUnique: systemSettingFindUnique },
  },
}));

vi.mock("@/lib/analytics", () => ({
  trackServer: (...args: unknown[]) => trackServerMock(...args),
}));

const SECRET = "whsec_" + Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
const ORIGINAL_ENV = process.env.RESEND_WEBHOOK_SECRET;

function signBody(body: string, id = "msg_1", ts = "1700000000"): Record<string, string> {
  const secretBytes = Buffer.from(SECRET.slice(6), "base64");
  const toSign = `${id}.${ts}.${body}`;
  const sig = "v1," + crypto.createHmac("sha256", secretBytes).update(toSign).digest("base64");
  return { "svix-id": id, "svix-timestamp": ts, "svix-signature": sig };
}

async function post(body: string, headers: Record<string, string> = {}) {
  const { POST } = await import("@/app/api/webhooks/resend/route");
  return POST(
    new Request("http://localhost/api/webhooks/resend", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    }),
  );
}

beforeEach(async () => {
  notificationUpdateMany.mockClear();
  notificationFindFirst.mockClear();
  notificationFindFirst.mockResolvedValue(null);
  trackServerMock.mockClear();
  systemSettingFindUnique.mockResolvedValue(null);
  process.env.RESEND_WEBHOOK_SECRET = SECRET;
  const { invalidateAll } = await import("@/lib/integration-config");
  invalidateAll();
});

afterEach(() => {
  process.env.RESEND_WEBHOOK_SECRET = ORIGINAL_ENV;
});

import { afterEach } from "vitest";

describe("Resend webhook", () => {
  it("rejects missing signature with 403", async () => {
    const res = await post(JSON.stringify({ type: "email.delivered", data: { email_id: "e_1" } }));
    expect(res.status).toBe(403);
  });

  it("rejects forged signature with 403", async () => {
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "e_1" } });
    const res = await post(body, {
      "svix-id": "msg_x",
      "svix-timestamp": "1700000000",
      "svix-signature": "v1,invalid",
    });
    expect(res.status).toBe(403);
  });

  it("marks Notification DELIVERED on email.delivered", async () => {
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "re_abc" } });
    const res = await post(body, signBody(body));
    expect(res.status).toBe(200);
    expect(notificationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "DELIVERED" } }),
    );
  });

  it("marks Notification FAILED on email.bounced", async () => {
    const body = JSON.stringify({ type: "email.bounced", data: { email_id: "re_def" } });
    await post(body, signBody(body));
    expect(notificationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "FAILED" } }),
    );
  });

  it("ignores unknown event types", async () => {
    const body = JSON.stringify({ type: "email.clicked", data: { email_id: "re_zzz" } });
    const res = await post(body, signBody(body));
    expect(res.status).toBe(200);
    expect(notificationUpdateMany).not.toHaveBeenCalled();
  });

  it("emits comms.email_bounced for the recipient on a bounce", async () => {
    notificationFindFirst.mockResolvedValue({ userId: "user_1" });
    const body = JSON.stringify({ type: "email.bounced", data: { email_id: "re_def" } });
    await post(body, signBody(body));
    expect(trackServerMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: "comms.email_bounced", distinctId: "user_1" }),
    );
  });

  it("does NOT emit to PostHog on delivered/opened (gated)", async () => {
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "re_abc" } });
    await post(body, signBody(body));
    expect(trackServerMock).not.toHaveBeenCalled();
  });
});
