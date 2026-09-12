import { describe, expect, it } from "vitest";

import {
  almatyOffsetMinutes,
  APP_TZ,
  dayIndex,
  diffDays,
  endOfLocalDayMs,
  localDateFromDayIndex,
  localDateFromInstant,
  rolling7dWindow,
  startOfLocalDayMs,
} from "@/lib/calc";

import { NOW_MS, OFF_BY_ONE, ROLLING_7D_WINDOW } from "./fixtures/r09-vectors";

describe("almatyOffsetMinutes", () => {
  it("is UTC+5 today", () => {
    expect(APP_TZ).toBe("Asia/Almaty");
    expect(almatyOffsetMinutes(NOW_MS)).toBe(300);
  });

  it("is UTC+6 before the 2024-03-01 change", () => {
    // Kazakhstan ran two zones until 2024-03-01. Imported pre-2024 history pushed through a
    // hardcoded +05:00 shifts by an hour, which is enough to move a late-evening session onto the
    // next calendar day. Resolving the offset through the IANA database gets both eras right.
    expect(almatyOffsetMinutes(Date.parse("2023-06-01T00:00:00Z"))).toBe(360);
    expect(almatyOffsetMinutes(Date.parse("2020-01-15T12:00:00Z"))).toBe(360);
  });

  it("switches at the transition instant, not a day either side of it", () => {
    expect(almatyOffsetMinutes(Date.parse("2024-02-29T17:59:59Z"))).toBe(360);
    expect(almatyOffsetMinutes(Date.parse("2024-02-29T18:00:00Z"))).toBe(300);
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["beyond the time-value limit", 9e15],
  ])("is null for %s", (_label, ms) => {
    expect(almatyOffsetMinutes(ms)).toBeNull();
  });
});

describe("localDateFromInstant", () => {
  it("puts a 00:30 local session on the day the user trained", () => {
    // The highest-risk bug in analytics. UTC+5 means local 00:00-05:00 falls on the previous UTC
    // date; grouping by UTC date drops this set and, in r09's worked week, 640 kg of chest volume
    // with it -- and it can drop a streak day, which is the exact rage-quit trigger.
    expect(localDateFromInstant(OFF_BY_ONE.insideMs)).toBe(OFF_BY_ONE.insideLocalDate);
    expect(localDateFromInstant(OFF_BY_ONE.outsideMs)).toBe(OFF_BY_ONE.outsideLocalDate);
  });

  it("zero-pads to exactly YYYY-MM-DD", () => {
    expect(localDateFromInstant(Date.parse("2026-01-05T00:00:00Z"))).toBe("2026-01-05");
    expect(localDateFromInstant(NOW_MS)).toBe("2026-09-13");
  });

  it("is null for an instant no Date can represent", () => {
    expect(localDateFromInstant(Number.NaN)).toBeNull();
    expect(localDateFromInstant(9e15)).toBeNull();
  });
});

describe("dayIndex", () => {
  it("counts days since 1970-01-01 on the local calendar", () => {
    expect(dayIndex("1970-01-01")).toBe(0);
    expect(dayIndex("1970-01-02")).toBe(1);
    expect(dayIndex("1969-12-31")).toBe(-1);
  });

  it.each([
    ["a single-digit month", "2026-9-7"],
    ["a single-digit day", "2026-09-7"],
    ["an impossible day", "2026-02-30"],
    ["an impossible month", "2026-13-01"],
    ["the empty string", ""],
    ["an ISO instant", "2026-09-07T00:00:00Z"],
    ["a two-digit year that Date.UTC would remap to 1999", "0099-12-26"],
  ])("is null for %s", (_label, date) => {
    expect(dayIndex(date)).toBeNull();
  });

  it("accepts a real leap day", () => {
    expect(dayIndex("2024-02-29")).not.toBeNull();
    expect(dayIndex("2026-02-29")).toBeNull();
  });
});

describe("localDateFromDayIndex", () => {
  it("inverts dayIndex", () => {
    for (const date of ["1970-01-01", "2026-09-07", "2024-02-29", "2099-12-31"]) {
      expect(localDateFromDayIndex(dayIndex(date) as number)).toBe(date);
    }
  });

  it.each([
    ["a fractional index", 1.5],
    ["NaN", Number.NaN],
    ["an index beyond the time-value limit", 1e12],
  ])("is null for %s", (_label, index) => {
    expect(localDateFromDayIndex(index)).toBeNull();
  });
});

describe("diffDays", () => {
  it.each([
    ["a full week span", "2026-09-07", "2026-09-13", 6],
    ["across a year boundary", "2025-12-31", "2026-01-01", 1],
    ["the same day", "2026-09-07", "2026-09-07", 0],
    ["backwards", "2026-09-13", "2026-09-07", -6],
    ["across a leap day", "2024-02-28", "2024-03-01", 2],
  ])("%s", (_label, a, b, expected) => {
    expect(diffDays(a, b)).toBe(expected);
  });

  it("is null when either date is malformed", () => {
    expect(diffDays("2026-9-7", "2026-09-13")).toBeNull();
    expect(diffDays("2026-09-07", "nope")).toBeNull();
  });
});

describe("startOfLocalDayMs / endOfLocalDayMs", () => {
  it("pins the r09 window bounds exactly", () => {
    expect(startOfLocalDayMs("2026-09-07")).toBe(ROLLING_7D_WINDOW.startMs);
    expect(endOfLocalDayMs("2026-09-13")).toBe(ROLLING_7D_WINDOW.endMs);
  });

  it("round-trips: the start of a local day is on that local day", () => {
    for (const date of ["2026-09-07", "2024-03-01", "2024-02-29", "2023-06-01", "2000-01-01"]) {
      const start = startOfLocalDayMs(date) as number;
      const end = endOfLocalDayMs(date) as number;
      expect(localDateFromInstant(start)).toBe(date);
      expect(localDateFromInstant(end)).toBe(date);
      expect(localDateFromInstant(start - 1)).not.toBe(date);
      expect(localDateFromInstant(end + 1)).not.toBe(date);
    }
  });

  it("uses the pre-2024 offset for a pre-2024 date", () => {
    expect(startOfLocalDayMs("2023-06-01")).toBe(Date.parse("2023-05-31T18:00:00Z"));
  });

  it("is exact across the single historical transition", () => {
    expect(startOfLocalDayMs("2024-03-01")).toBe(Date.parse("2024-02-29T19:00:00Z"));
    expect(startOfLocalDayMs("2024-02-29")).toBe(Date.parse("2024-02-28T18:00:00Z"));
  });

  it("handles the 25-hour local day the 2024 transition created", () => {
    // At 18:00Z on 2024-02-29 the zone moved from UTC+6 to UTC+5, so local 23:00-24:00 happened
    // twice and the day did not close until 19:00Z. A `start + 24 h` shortcut ends it an hour early.
    expect(endOfLocalDayMs("2024-02-29")).toBe(Date.parse("2024-02-29T19:00:00Z") - 1);
    expect(
      (endOfLocalDayMs("2024-02-29") as number) - (startOfLocalDayMs("2024-02-29") as number) + 1,
    ).toBe(25 * 60 * 60 * 1000);
  });

  it("is null for a malformed date", () => {
    expect(startOfLocalDayMs("2026-02-30")).toBeNull();
    expect(endOfLocalDayMs("2026-02-30")).toBeNull();
  });

  it("is null at the far edge of the four-digit calendar", () => {
    // The day after 9999-12-31 has no four-digit year, so its opening instant cannot be named.
    expect(endOfLocalDayMs("9999-12-31")).toBeNull();
  });
});

describe("rolling7dWindow", () => {
  it("reproduces the r09 worked window exactly", () => {
    expect(rolling7dWindow(NOW_MS)).toEqual(ROLLING_7D_WINDOW);
  });

  it("always spans exactly 7 local days, both bounds inclusive", () => {
    // The 2024-03-01 anchor is the one that matters: that window is seven local days but 167 hours,
    // so any "7 x 24 h" shortcut inside `rolling7dWindow` fails here and nowhere else.
    for (const ms of [NOW_MS, 0, 1_000_000_000_000, Date.parse("2024-03-01T00:30:00+05:00")]) {
      const w = rolling7dWindow(ms);
      expect(w).not.toBeNull();
      expect(diffDays(w?.startDate ?? "", w?.endDate ?? "")).toBe(6);
      expect(w?.startMs).toBe(startOfLocalDayMs(w?.startDate ?? ""));
      expect(w?.endMs).toBe(endOfLocalDayMs(w?.endDate ?? ""));
    }
  });

  it("contains the instant it was anchored on", () => {
    const w = rolling7dWindow(NOW_MS);
    expect(NOW_MS).toBeGreaterThanOrEqual(w?.startMs ?? 0);
    expect(NOW_MS).toBeLessThanOrEqual(w?.endMs ?? 0);
  });

  it.each([
    ["NaN", Number.NaN],
    ["beyond the time-value limit", 9e15],
    ["an instant whose local year has five digits", 8.64e15],
    ["an instant whose local year is below 100", -62_135_596_800_000],
    ["an instant on the last representable day", Date.parse("9999-12-31T12:00:00Z")],
  ])("is null for %s", (_label, ms) => {
    expect(rolling7dWindow(ms)).toBeNull();
  });

  it("is null when the window start falls before the representable calendar", () => {
    // Year 0100 exists as a LocalDate, but six days earlier lands in year 0099, which Date.UTC
    // remaps to 1999 -- so the window cannot be built and must say so rather than guess.
    const ms = Date.parse("0100-01-03T12:00:00Z");
    expect(rolling7dWindow(ms)).toBeNull();
  });
});
