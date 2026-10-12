/**
 * Time helpers. Pure functions take `now: Date` as an argument; nothing here reads the
 * system clock except `systemNow()`. Server code should use `getNow()` from
 * `@/server/clock`, which honours the demo time-travel offset.
 *
 * Merchant-local calculations use IANA time zones (e.g. "Asia/Singapore") via Intl, so
 * no date library is required.
 */

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** The real system clock. Prefer injected `now` values in business logic. */
export function systemNow(): Date {
  return new Date();
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MINUTE_MS);
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * HOUR_MS);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Fractional days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / DAY_MS;
}

/** Whole days elapsed from `from` to `to`, floored (0 for less than a day). */
export function wholeDaysBetween(from: Date, to: Date): number {
  return Math.floor(daysBetween(from, to));
}

export interface LocalParts {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
  /** 0-23 */
  hour: number;
  minute: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string) {
  let f = partsFormatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
    });
    partsFormatterCache.set(timeZone, f);
  }
  return f;
}

/** Calendar parts of an instant as seen in `timeZone`. */
export function localParts(date: Date, timeZone: string): LocalParts {
  const parts = partsFormatter(timeZone).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    weekday: WEEKDAYS[get("weekday")] ?? 0,
  };
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const truncated = Math.floor(date.getTime() / MINUTE_MS) * MINUTE_MS;
  return asUtc - truncated;
}

/** Convert a merchant-local wall-clock time to a UTC instant. */
export function zonedDateTime(
  local: { year: number; month: number; day: number; hour?: number; minute?: number },
  timeZone: string,
): Date {
  const guess = Date.UTC(local.year, local.month - 1, local.day, local.hour ?? 0, local.minute ?? 0);
  // Two passes handle DST transitions correctly for the vast majority of zones.
  let instant = guess - zoneOffsetMs(new Date(guess), timeZone);
  instant = guess - zoneOffsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

/** Midnight (local) of the day containing `date`, as a UTC instant. */
export function startOfLocalDay(date: Date, timeZone: string): Date {
  const p = localParts(date, timeZone);
  return zonedDateTime({ year: p.year, month: p.month, day: p.day }, timeZone);
}

/** Parse "HH:MM" into minutes after midnight. */
export function parseHHMM(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * True when `date` falls inside the local window [start, end). Windows may cross
 * midnight, e.g. quiet hours "21:00"–"09:00".
 */
export function isWithinLocalWindow(date: Date, timeZone: string, start: string, end: string): boolean {
  const p = localParts(date, timeZone);
  const minutes = p.hour * 60 + p.minute;
  const s = parseHHMM(start);
  const e = parseHHMM(end);
  if (s === e) return false;
  return s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
}

/**
 * The next instant at or after `after` whose local time is `hour:minute`, optionally
 * restricted to a weekday (0 = Sunday).
 */
export function nextLocalTime(
  after: Date,
  timeZone: string,
  hour: number,
  minute = 0,
  weekday?: number,
): Date {
  const p = localParts(after, timeZone);
  for (let offset = 0; offset < 8; offset++) {
    const day = new Date(Date.UTC(p.year, p.month - 1, p.day + offset));
    const candidate = zonedDateTime(
      { year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate(), hour, minute },
      timeZone,
    );
    if (candidate.getTime() < after.getTime()) continue;
    if (weekday !== undefined && localParts(candidate, timeZone).weekday !== weekday) continue;
    return candidate;
  }
  return addDays(after, 1);
}

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Format a date in the merchant's zone, e.g. "Fri, 17 Oct 2026". */
export function formatDate(
  date: Date,
  options: { timeZone?: string; locale?: string; withTime?: boolean } = {},
): string {
  const { timeZone = "Asia/Singapore", locale = "en-SG", withTime = false } = options;
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(date);
}

/** Human phrase for a day count: 0 → "today", 1 → "1 day", 12 → "12 days". */
export function formatDays(days: number): string {
  const d = Math.round(days);
  if (d === 0) return "today";
  return `${Math.abs(d)} day${Math.abs(d) === 1 ? "" : "s"}`;
}

/** "3 days ago" / "in 5 days" relative to `now`. */
export function formatRelative(date: Date, now: Date): string {
  const days = Math.round(daysBetween(now, date));
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}
