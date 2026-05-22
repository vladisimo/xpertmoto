export type CalendarEvent = {
  uid: string;
  title: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  url?: string;
  /** iCalendar PRODID product name — pass the branding siteName so the
   *  generated calendar identifies the current tenant. */
  prodId?: string;
};

function pad(n: number, width = 2): string {
  return n.toString().padStart(width, "0");
}

function fmtUtc(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let i = 0;
  while (i < line.length) {
    parts.push(line.slice(i, i + 73));
    i += 73;
  }
  return parts.join("\r\n ");
}

export function generateIcs(event: CalendarEvent): string {
  const now = new Date();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${event.prodId ?? "XPERT Moto"}//Bookings//EN`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${fmtUtc(now)}`,
    `DTSTART:${fmtUtc(event.start)}`,
    `DTEND:${fmtUtc(event.end)}`,
    fold(`SUMMARY:${escapeText(event.title)}`),
    event.description ? fold(`DESCRIPTION:${escapeText(event.description)}`) : null,
    event.location ? fold(`LOCATION:${escapeText(event.location)}`) : null,
    event.url ? `URL:${event.url}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return lines.join("\r\n");
}

export function googleCalendarUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${fmtUtc(event.start)}/${fmtUtc(event.end)}`,
    details: event.description ?? "",
    location: event.location ?? "",
  });
  return `https://www.google.com/calendar/render?${params.toString()}`;
}
