/**
 * Calendar reminders for a drop (brief item 14): an .ics file (RFC 5545) served as
 * text/calendar, and a Google Calendar link. Times are UTC; iPhone Safari offers to add
 * the .ics to Calendar.
 */
export type DropEvent = { id: string; setName: string; startsAt: Date; endsAt: Date | null; url: string };

// 20261003T020000Z
const utc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
// Escape text values: backslash, semicolon, comma, newline.
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
// Lines longer than 75 octets are folded with CRLF and a space.
function fold(line: string) {
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest, "utf8") > 75) {
    let n = 75;
    while (Buffer.byteLength(rest.slice(0, n), "utf8") > 75) n--;
    out.push(rest.slice(0, n));
    rest = " " + rest.slice(n);
  }
  out.push(rest);
  return out.join("\r\n");
}

/** A drop without its own end time shows as one hour. */
const endOf = (e: DropEvent) => e.endsAt ?? new Date(e.startsAt.getTime() + 60 * 60 * 1000);

export function dropIcs(e: DropEvent, now = new Date()) {
  const summary = `CrackAPack drop: ${e.setName}`;
  const description = `This is when the set goes live on CrackAPack. ${e.url}`;
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CrackAPack//Drops//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:drop-${e.id}@crackapack`,
    `DTSTAMP:${utc(now)}`,
    `DTSTART:${utc(e.startsAt)}`,
    `DTEND:${utc(endOf(e))}`,
    `SUMMARY:${esc(summary)}`,
    `DESCRIPTION:${esc(description)}`,
    `URL:${e.url}`,
    `LOCATION:${esc(e.url)}`,
    "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(summary)}`, "TRIGGER:-PT24H", "END:VALARM",
    "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(summary)}`, "TRIGGER:-PT15M", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function googleCalendarUrl(e: DropEvent) {
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: `CrackAPack drop: ${e.setName}`,
    dates: `${utc(e.startsAt)}/${utc(endOf(e))}`,
    details: `This is when the set goes live on CrackAPack. ${e.url}`,
    location: e.url,
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}
