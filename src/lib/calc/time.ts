/**
 * `Asia/Almaty` calendar arithmetic.
 *
 * Two rules shape this file.
 *
 * **1. No ambient time.** Nothing here reads the clock. Neither `Date.now` nor the zero-argument
 * `Date` constructor appears anywhere in `src/lib/calc` -- a test greps for both -- and every
 * function that needs the current instant takes `nowMs` as its first parameter. That is what makes the tests deterministic, and it is also
 * what lets the same code run server-side in a Cron batch and client-side over Dexie's replay
 * queue and produce bit-identical results.
 *
 * **2. The offset comes from the IANA database, never from arithmetic on a hardcoded `+5`.**
 * `Asia/Almaty` is UTC+5 with no DST -- *but only since 2024-03-01*. Before that it was UTC+6.
 * Imported pre-2024 history (spec 15) pushed through a hardcoded `+05:00` shifts by an hour, and
 * an hour is enough to move a late-evening session onto the next calendar day, which corrupts the
 * streak counter. `Intl.DateTimeFormat` with an explicit `timeZone` gets both eras right for free.
 *
 * The highest-risk bug this file exists to prevent: UTC+5 means local `00:00`-`05:00` falls on the
 * *previous* UTC date. `2026-09-06T19:30:00Z` is local `2026-09-07`. Grouping by UTC date instead
 * loses 640 kg of chest volume from r09's worked week and can silently drop a streak day.
 *
 * A `LocalDate` is exactly `YYYY-MM-DD` -- zero-padded, four-digit year. The strictness is not
 * pedantry: the format is the sort key for every calendar query, and `'2026-9-7'` sorts after
 * `'2026-12-01'` as a string.
 */

import { APP_TZ, MAX_TIME_MS, MS_PER_DAY, MS_PER_MINUTE, ROLLING_WINDOW_DAYS } from "./constants";
import { isFiniteNum } from "./num";
import type { LocalDate } from "./types";

/**
 * One formatter, created once.
 *
 * `hourCycle: "h23"` is required rather than cosmetic: several locales render midnight as hour
 * "24", which would push the derived offset a full day off.
 */
const ALMATY_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

type WallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** `true` if `epochMs` is a real instant a `Date` can represent. */
function inTimeRange(epochMs: number): boolean {
  return isFiniteNum(epochMs) && Math.abs(epochMs) <= MAX_TIME_MS;
}

/**
 * `Asia/Almaty` wall-clock fields for an in-range instant.
 *
 * The accumulator starts fully populated so there is no "field missing" path to defend against --
 * `formatToParts` always emits every field the formatter was configured with, and an unreachable
 * guard is a permanently untested one in a module held to 100% coverage.
 */
function wallClock(epochMs: number): WallClock {
  const wc: WallClock = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const part of ALMATY_PARTS.formatToParts(epochMs)) {
    switch (part.type) {
      case "year":
        wc.year = Number(part.value);
        break;
      case "month":
        wc.month = Number(part.value);
        break;
      case "day":
        wc.day = Number(part.value);
        break;
      case "hour":
        wc.hour = Number(part.value);
        break;
      case "minute":
        wc.minute = Number(part.value);
        break;
      case "second":
        wc.second = Number(part.value);
        break;
      default:
        break;
    }
  }
  return wc;
}

/**
 * The offset, for an instant already known to be in range.
 *
 * Derived rather than tabled: render the instant as local wall-clock fields, reinterpret those
 * fields as if they were UTC, and the difference is the offset. Correct for any zone and any era
 * without us maintaining a transition table.
 */
function offsetMinutesRaw(epochMs: number): number {
  const wc = wallClock(epochMs);
  const asUtc = Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute, wc.second);
  // Wall-clock fields carry second resolution, so compare against a second-floored instant.
  const flooredMs = Math.floor(epochMs / 1000) * 1000;
  return Math.round((asUtc - flooredMs) / MS_PER_MINUTE);
}

/** `YYYY-MM-DD` for an instant already known to be in range. */
function localDateRaw(epochMs: number): LocalDate {
  const wc = wallClock(epochMs);
  return `${pad(wc.year, 4)}-${pad(wc.month, 2)}-${pad(wc.day, 2)}`;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/**
 * The `Asia/Almaty` UTC offset in minutes: `300` today, `360` before the 2024-03-01 change.
 *
 * Only imported pre-2024 history ever reaches the `360` era, and the worst case there is a
 * one-hour error at that single boundary instant.
 */
export function almatyOffsetMinutes(epochMs: number): number | null {
  return inTimeRange(epochMs) ? offsetMinutesRaw(epochMs) : null;
}

/** The Almaty calendar day an instant falls on. */
export function localDateFromInstant(epochMs: number): LocalDate | null {
  return inTimeRange(epochMs) ? localDateRaw(epochMs) : null;
}

/**
 * Parse a `LocalDate` into calendar fields, or `null` if it is not a real date.
 *
 * The `toISOString` round-trip *is* the validation, and it catches three separate classes of bad
 * input that a regex cannot: an impossible day (`'2026-02-30'` silently normalises to March 2), an
 * impossible month (`'2026-13-01'` rolls into the next year), and `Date.UTC`'s two-digit-year
 * quirk, which maps year `0099` onto 1999. Each of those would otherwise produce a plausible
 * number for a date the user never entered.
 */
function parseLocalDate(d: LocalDate): { year: number; month: number; day: number } | null {
  const m = LOCAL_DATE_RE.exec(d);
  if (m === null) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) !== d) return null;
  return { year, month, day };
}

/**
 * Days since `1970-01-01` on the local calendar.
 *
 * No timezone is involved: a `LocalDate` is a label, and the number of days between two labels
 * does not depend on any offset. This is the value the gap-aware EMA and every rolling window
 * count in, which is why it must never be derived from a UTC timestamp at read time.
 */
export function dayIndex(d: LocalDate): number | null {
  const parts = parseLocalDate(d);
  if (parts === null) return null;
  return Date.UTC(parts.year, parts.month - 1, parts.day) / MS_PER_DAY;
}

/** `YYYY-MM-DD` for a day index already known to be in range. */
function localDateFromDaysRaw(index: number): LocalDate {
  const d = new Date(index * MS_PER_DAY);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`;
}

/** The inverse of `dayIndex`. */
export function localDateFromDayIndex(index: number): LocalDate | null {
  if (!Number.isInteger(index)) return null;
  if (Math.abs(index * MS_PER_DAY) > MAX_TIME_MS) return null;
  return localDateFromDaysRaw(index);
}

/** `dayIndex(b) - dayIndex(a)`. Positive when `b` is the later date. */
export function diffDays(a: LocalDate, b: LocalDate): number | null {
  const ia = dayIndex(a);
  const ib = dayIndex(b);
  if (ia === null || ib === null) return null;
  return ib - ia;
}

/**
 * The instant of local midnight opening a calendar day.
 *
 * One pass is exact here, and that is a property of this zone rather than a shortcut. The offset
 * used is the one in force at "midnight interpreted as UTC"; it could differ from the offset at
 * the resulting instant only if a transition fell between them. `Asia/Almaty` has no DST and
 * exactly one historical transition (2024-02-29T18:00Z), and for every local date the interval
 * between those two candidate instants excludes it. A zone with DST would need a second pass.
 */
export function startOfLocalDayMs(d: LocalDate): number | null {
  const parts = parseLocalDate(d);
  if (parts === null) return null;
  const midnightAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
  return midnightAsUtc - offsetMinutesRaw(midnightAsUtc) * MS_PER_MINUTE;
}

/**
 * The last instant of a local calendar day, one millisecond before the next day opens.
 *
 * Computed from the *next* day's own offset rather than as `start + 24 h`, because a local day is not
 * always 24 hours long. `2024-02-29` in `Asia/Almaty` is **25 hours**: at `18:00Z` that day the zone
 * moved from UTC+6 to UTC+5, so local `23:00`-`24:00` happened twice and the day did not close until
 * `2024-02-29T19:00Z`. A 24-hour assumption would put this boundary an hour early and quietly drop an
 * hour of that day's imported sets.
 */
export function endOfLocalDayMs(d: LocalDate): number | null {
  const index = dayIndex(d);
  if (index === null) return null;
  const nextDayMs = startOfLocalDayMs(localDateFromDaysRaw(index + 1));
  return nextDayMs === null ? null : nextDayMs - 1;
}

/**
 * The rolling 7-day window ending on the local day containing `nowMs`. Both bounds inclusive, 7
 * local calendar days including today.
 *
 * Callers should prefer `local_date BETWEEN startDate AND endDate`: a string comparison against a
 * column computed once at write time cannot drift. The millisecond bounds exist only for `BETWEEN`
 * against a raw UTC timestamp.
 */
export function rolling7dWindow(
  nowMs: number,
): { startDate: LocalDate; endDate: LocalDate; startMs: number; endMs: number } | null {
  const endDate = localDateFromInstant(nowMs);
  if (endDate === null) return null;
  const endIndex = dayIndex(endDate);
  if (endIndex === null) return null;

  // `endIndex` came from a four-digit-year date, so shifting it six days cannot leave the
  // representable range -- but the *result* can be a date the calendar cannot express (year 0099,
  // which `Date.UTC` remaps to 1999), and the day after `9999-12-31` has no four-digit year either.
  const startDate = localDateFromDaysRaw(endIndex - (ROLLING_WINDOW_DAYS - 1));
  const startMs = startOfLocalDayMs(startDate);

  // `endMs` must come from the end day's own bounds, not from `startMs + 7 days`: the window that
  // spans the 2024-03-01 transition is seven local days but only 167 hours long, and assuming 168
  // would push `endMs` an hour into the following day.
  const endMs = endOfLocalDayMs(endDate);
  if (startMs === null || endMs === null) return null;
  return { startDate, endDate, startMs, endMs };
}
