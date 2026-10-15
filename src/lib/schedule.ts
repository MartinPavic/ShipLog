export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

type Schedule = { enabled: boolean; dayOfWeek: number; hour: number; timezone: string };

// The slot is the project's local date. It is due on the chosen weekday from the chosen hour until midnight,
// so a late or missed cron tick still runs the same day, and the date doubles as the idempotency key.
export function currentSlot(schedule: Schedule, now: Date): string | null {
  if (!schedule.enabled || !isValidTimezone(schedule.timezone)) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: schedule.timezone,
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  if (weekday !== schedule.dayOfWeek || Number(get("hour")) < schedule.hour) return null;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
