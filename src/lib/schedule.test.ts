import { describe, expect, it } from "vitest";
import { currentSlot, isValidTimezone } from "./schedule";

const base = { enabled: true, dayOfWeek: 3, hour: 9, timezone: "UTC" }; // Wednesday 09:00

describe("currentSlot", () => {
  it("is due from the chosen hour until the end of the local day", () => {
    expect(currentSlot(base, new Date("2026-10-14T08:59:00Z"))).toBeNull();
    expect(currentSlot(base, new Date("2026-10-14T09:00:00Z"))).toBe("2026-10-14");
    expect(currentSlot(base, new Date("2026-10-14T23:59:00Z"))).toBe("2026-10-14");
    expect(currentSlot(base, new Date("2026-10-15T00:00:00Z"))).toBeNull();
  });

  it("is not due on other weekdays", () => {
    expect(currentSlot(base, new Date("2026-10-13T12:00:00Z"))).toBeNull(); // Tuesday
    expect(currentSlot(base, new Date("2026-10-21T12:00:00Z"))).toBe("2026-10-21"); // next Wednesday
  });

  it("uses the project's timezone for both weekday and hour", () => {
    const ny = { ...base, timezone: "America/New_York" }; // UTC-4 in October
    expect(currentSlot(ny, new Date("2026-10-14T12:59:00Z"))).toBeNull();
    expect(currentSlot(ny, new Date("2026-10-14T13:00:00Z"))).toBe("2026-10-14");
    // Still Wednesday evening in New York while it is already Thursday in UTC.
    expect(currentSlot(ny, new Date("2026-10-15T02:00:00Z"))).toBe("2026-10-14");

    const tokyo = { ...base, timezone: "Asia/Tokyo" }; // UTC+9
    expect(currentSlot(tokyo, new Date("2026-10-13T23:59:00Z"))).toBeNull(); // Wed 08:59 JST
    expect(currentSlot(tokyo, new Date("2026-10-14T00:00:00Z"))).toBe("2026-10-14");
    expect(currentSlot(tokyo, new Date("2026-10-14T15:00:00Z"))).toBeNull(); // Thu 00:00 JST
  });

  it("gives one slot for the repeated hour when clocks go back", () => {
    const sunday = { enabled: true, dayOfWeek: 0, hour: 1, timezone: "America/New_York" };
    const first = currentSlot(sunday, new Date("2026-11-01T05:30:00Z")); // 01:30 EDT
    const second = currentSlot(sunday, new Date("2026-11-01T06:30:00Z")); // 01:30 EST
    expect(first).toBe("2026-11-01");
    expect(second).toBe(first);
  });

  it("is never due when disabled or the timezone is unknown", () => {
    const now = new Date("2026-10-14T12:00:00Z");
    expect(currentSlot({ ...base, enabled: false }, now)).toBeNull();
    expect(currentSlot({ ...base, timezone: "Mars/Base" }, now)).toBeNull();
  });

  it("handles midnight as hour 0", () => {
    expect(currentSlot({ ...base, hour: 0 }, new Date("2026-10-14T00:00:00Z"))).toBe("2026-10-14");
  });
});

describe("isValidTimezone", () => {
  it("accepts IANA names and rejects junk", () => {
    expect(isValidTimezone("Europe/Zagreb")).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("Mars/Base")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
  });
});
