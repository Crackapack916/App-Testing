import { describe, expect, it } from "vitest";
import { dropIcs, googleCalendarUrl } from "../src/calendar";

// Item 14: the calendar file and the Google Calendar link.
const e = { id: "d1", setName: "Foundations, Play Booster; test", startsAt: new Date("2026-10-03T02:00:00Z"), endsAt: null, url: "https://crackapack.test/drops" };

describe("drop calendar file", () => {
  const ics = dropIcs(e, new Date("2026-09-28T12:00:00Z"));
  const lines = ics.split("\r\n");
  it("is a valid single event with UID, DTSTAMP, UTC start and end, summary and description", () => {
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines).toContain("UID:drop-d1@crackapack");
    expect(lines).toContain("DTSTAMP:20260928T120000Z");
    expect(lines).toContain("DTSTART:20261003T020000Z");
    expect(lines).toContain("DTEND:20261003T030000Z");
    expect(lines).toContain("SUMMARY:CrackAPack drop: Foundations\\, Play Booster\; test");
    expect(ics).toContain("DESCRIPTION:This is when the set goes live on CrackAPack.");
    expect(lines.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(1);
  });
  it("has reminder alarms 24 hours and 15 minutes before", () => {
    expect(lines.filter((l) => l === "BEGIN:VALARM")).toHaveLength(2);
    expect(lines).toContain("TRIGGER:-PT24H");
    expect(lines).toContain("TRIGGER:-PT15M");
  });
  it("folds long lines to 75 octets", () => {
    const long = dropIcs({ ...e, setName: "x".repeat(200) });
    for (const l of long.split("\r\n")) expect(Buffer.byteLength(l, "utf8")).toBeLessThanOrEqual(75);
  });
  it("builds a Google Calendar template link in UTC", () => {
    const u = new URL(googleCalendarUrl(e));
    expect(u.origin + u.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(u.searchParams.get("action")).toBe("TEMPLATE");
    expect(u.searchParams.get("dates")).toBe("20261003T020000Z/20261003T030000Z");
    expect(u.searchParams.get("text")).toBe("CrackAPack drop: Foundations, Play Booster; test");
    expect(u.searchParams.get("location")).toBe("https://crackapack.test/drops");
  });
});
