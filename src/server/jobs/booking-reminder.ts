import { render } from "@react-email/render";
import { createElement } from "react";

import { prisma } from "@/lib/prisma";
import { getSettings, SETTING_DEFAULTS } from "@/lib/settings";
import { getBranding } from "@/lib/branding";
import { sendNotification } from "@/server/services/notification-sender";
import { trackServer } from "@/lib/analytics";
import { SERVER_EVENTS } from "@/lib/analytics/server-event-names";
import BookingReminder from "../../../emails/booking-reminder";
import { getQueue, registerWorker } from "./queue";

const QUEUE = "booking-reminder" as const;

/**
 * Runs daily (07:00). Finds all bookings whose pickup falls inside a
 * 23–25 hour future window and sends email + SMS reminders. Dedup is
 * achieved by the 2-hour window — a given booking crosses the window once.
 */
export async function runBookingReminders(): Promise<number> {
  const cfg = await getSettings([
    "notification.reminderHoursBefore",
    "notification.enableEmail",
    "notification.enableSms",
  ] as const);
  const leadHours = cfg["notification.reminderHoursBefore"] ?? SETTING_DEFAULTS["notification.reminderHoursBefore"];
  const now = new Date();
  const windowStart = new Date(now.getTime() + (leadHours - 1) * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + (leadHours + 1) * 60 * 60 * 1000);

  const bookings = await prisma.booking.findMany({
    where: {
      status: "CONFIRMED",
      pickupDateTime: { gte: windowStart, lte: windowEnd },
    },
    include: {
      customer: true,
      category: true,
      pickupDepot: true,
    },
  });

  const channels: ("EMAIL" | "SMS")[] = [];
  if (cfg["notification.enableEmail"]) channels.push("EMAIL");
  if (cfg["notification.enableSms"]) channels.push("SMS");
  if (channels.length === 0) return 0;

  const { siteName } = await getBranding();
  for (const b of bookings) {
    const dateStr = b.pickupDateTime.toLocaleString("en-AU", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: "Australia/Brisbane",
    });
    const html = await render(
      createElement(BookingReminder, {
        customerName: b.customer.firstName,
        bookingReference: b.bookingReference,
        pickupDepotName: b.pickupDepot.name,
        pickupDepotAddress: `${b.pickupDepot.addressLine1}, ${b.pickupDepot.suburb} ${b.pickupDepot.state} ${b.pickupDepot.postcode}`,
        pickupDateTime: dateStr,
        categoryName: b.category.name,
        siteName,
      }),
    );
    const sentChannels = b.customer.phone ? channels : channels.filter((c) => c !== "SMS");
    await sendNotification({
      userId: b.customerId,
      type: "BOOKING_REMINDER",
      channels: sentChannels,
      subject: `Reminder: your ${siteName} pickup is tomorrow (${b.bookingReference})`,
      title: `Pickup tomorrow — ${b.bookingReference}`,
      html,
      body: `${siteName}: your ${b.category.name} pickup is tomorrow at ${b.pickupDepot.name}. Ref ${b.bookingReference}. Bring ID + licence.`,
      bookingId: b.id,
      data: {
        bookingReference: b.bookingReference,
        pickupAt: b.pickupDateTime.toISOString(),
        depotName: b.pickupDepot.name,
      },
    });
    await trackServer({
      event: SERVER_EVENTS.bookingReminderSent,
      distinctId: b.customerId,
      properties: {
        bookingId: b.id,
        reference: b.bookingReference,
        channels: sentChannels,
        pickupAt: b.pickupDateTime.toISOString(),
      },
      groups: { depot: b.pickupDepot.slug },
    });
  }

  return bookings.length;
}

export function startBookingReminderScheduler() {
  registerWorker(QUEUE, async () => runBookingReminders());
  const q = getQueue(QUEUE);
  if (!q) return;
  q.add(
    "daily",
    {},
    { repeat: { pattern: "0 7 * * *", tz: "Australia/Brisbane" }, jobId: "repeat-daily" },
  );
}
