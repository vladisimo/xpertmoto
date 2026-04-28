import type { NotificationChannel } from "@prisma/client";

import { getSettings } from "@/lib/settings";

export type GateDecision =
  | { send: true }
  | { send: false; reason: "paused" | "channel_disabled" };

const GATE_KEYS = [
  "notification.pauseAll",
  "notification.enableEmail",
  "notification.enableSms",
  "notification.enablePush",
  "notification.enableInApp",
] as const;

export async function evaluateNotificationGate(
  channel: NotificationChannel,
): Promise<GateDecision> {
  const cfg = await getSettings(GATE_KEYS);
  if (cfg["notification.pauseAll"]) return { send: false, reason: "paused" };

  const enabled =
    channel === "EMAIL"
      ? cfg["notification.enableEmail"]
      : channel === "SMS"
        ? cfg["notification.enableSms"]
        : channel === "PUSH"
          ? cfg["notification.enablePush"]
          : cfg["notification.enableInApp"];

  if (!enabled) return { send: false, reason: "channel_disabled" };
  return { send: true };
}

export async function isNotificationsPaused(): Promise<boolean> {
  const cfg = await getSettings(["notification.pauseAll"] as const);
  return Boolean(cfg["notification.pauseAll"]);
}
