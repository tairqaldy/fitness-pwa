/**
 * Time handling. The single source of truth for "what day is it".
 *
 * The user is in Asia/Almaty (UTC+05, no DST). The Workers runtime defaults to UTC, so any
 * "today" derived from a raw epoch is wrong for five hours out of every twenty-four. That
 * would silently corrupt the streak logic, the calendar heatmap and the rolling-7-day volume
 * windows — the bug is invisible on a dev machine in the same zone.
 *
 * Rule: instants are epoch-ms UTC; calendar days are 'YYYY-MM-DD' strings computed HERE.
 * Every function takes `now` explicitly so callers stay testable.
 */
export const APP_TIME_ZONE = "Asia/Almaty";

/** A calendar day in the app's timezone, as 'YYYY-MM-DD'. */
export type DayKey = string;

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * The calendar day an instant falls on, in the app's timezone.
 * `en-CA` is used because it formats as YYYY-MM-DD natively, which avoids hand-assembling
 * parts and getting the padding wrong.
 */
export function dayKeyOf(instantMs: number): DayKey {
  return dayFormatter.format(new Date(instantMs));
}

/** Today, in the app's timezone. */
export function todayInAppZone(nowMs: number): DayKey {
  return dayKeyOf(nowMs);
}

/** Add (or subtract) whole days to a day key, staying in calendar space. */
export function addDays(day: DayKey, delta: number): DayKey {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  // Midday UTC avoids any chance of a DST or offset edge flipping the date during arithmetic.
  const base = Date.UTC(y, m - 1, d, 12, 0, 0);
  const moved = new Date(base + delta * 86_400_000);
  const yy = moved.getUTCFullYear();
  const mm = String(moved.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(moved.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: DayKey, to: DayKey): number {
  const parse = (day: DayKey) => {
    const [y, m, d] = day.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d, 12, 0, 0);
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

/** True for a syntactically valid 'YYYY-MM-DD' that names a real date. */
export function isDayKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d, 12));
  return probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}
