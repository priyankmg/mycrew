/**
 * Timezone-aware clock maths.
 *
 * Attendance is a local-time concept: "today" and "8:45am" are meaningless
 * without the account's IANA zone. These helpers are pure so they can be
 * unit-tested without a database, and they are the only place wall-clock
 * times are converted to UTC instants.
 */

const TIME_RE =
  /^(?:(\d{1,2})(?::(\d{2}))?\s*(am|pm)|(\d{1,2}):(\d{2}))$/i;

export function formatDateInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** "8:45am", "12:00pm" — short enough to read back in a chat reply. */
export function formatTimeInZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);

  const hour = parts.find((part) => part.type === "hour")?.value ?? "0";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  const dayPeriod = (
    parts.find((part) => part.type === "dayPeriod")?.value ?? "am"
  ).toLowerCase();

  return `${hour}:${minute}${dayPeriod}`;
}

/**
 * Interpret a wall-clock time on a calendar date in `timeZone` as a UTC
 * instant. Two-pass so DST transitions land on the offset that actually
 * applies at that local time.
 */
export function instantInZone(
  dateYmd: string,
  timeHm: string,
  timeZone: string,
): Date {
  const [year, month, day] = dateYmd.split("-").map(Number);
  const [hour, minute] = timeHm.split(":").map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined
  ) {
    throw new RangeError(`Invalid local time ${dateYmd} ${timeHm}`);
  }

  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const first = new Date(utcGuess - offsetAt(new Date(utcGuess), timeZone));
  return new Date(utcGuess - offsetAt(first, timeZone));
}

/**
 * Parse a clock time from chat. Accepts "8:45am", "17:30", "9am".
 * Returns 24-hour `HH:MM`, or null if the string is not a time.
 */
export function parseClockTime(raw: string): string | null {
  const match = TIME_RE.exec(raw.trim());
  if (!match) return null;

  if (match[4] !== undefined) {
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    if (hour > 23 || minute > 59) return null;
    return `${pad(hour)}:${pad(minute)}`;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const meridiem = match[3]?.toLowerCase();
  if (hour > 12 || minute > 59) return null;
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return `${pad(hour)}:${pad(minute)}`;
}

/** Midnight UTC of a YYYY-MM-DD calendar date, for Prisma `@db.Date` columns. */
export function dateOnly(ymd: string): Date {
  const [year, month, day] = ymd.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new RangeError(`Invalid date ${ymd}`);
  }
  return new Date(Date.UTC(year, month - 1, day));
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(dateOnly(value).getTime());
}

function offsetAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);

  const asUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );
  return asUtc - instant.getTime();
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
