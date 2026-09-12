import { describe, expect, it } from "vitest";

import en from "../messages/en.json";
import ru from "../messages/ru.json";
import { DEFAULT_LOCALE, isLocale, LOCALES } from "@/i18n/config";
import { addDays, APP_TIME_ZONE, dayKeyOf, daysBetween, isDayKey } from "@/lib/time";

function flatten(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("message catalogues", () => {
  // Without this, a locale silently renders raw keys like "Workout.setsLabel" mid-set.
  it("have identical key shapes", () => {
    expect(flatten(en).sort()).toEqual(flatten(ru).sort());
  });

  it("have no empty strings", () => {
    for (const [locale, messages] of [
      ["ru", ru],
      ["en", en],
    ] as const) {
      const empties = flatten(messages).filter((path) => {
        const value = path
          .split(".")
          .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], messages);
        return typeof value === "string" && value.trim() === "";
      });
      expect(empties, `${locale} has empty messages`).toEqual([]);
    }
  });
});

describe("locale config", () => {
  it("defaults to Russian", () => {
    expect(DEFAULT_LOCALE).toBe("ru");
    expect(LOCALES).toContain("ru");
  });
  it.each([
    ["ru", true],
    ["en", true],
    ["de", false],
    [undefined, false],
  ])("isLocale(%s) === %s", (value, expected) => {
    expect(isLocale(value as string | undefined)).toBe(expected);
  });
});

describe("app timezone day keys", () => {
  it("is pinned to Asia/Almaty", () => {
    expect(APP_TIME_ZONE).toBe("Asia/Almaty");
  });

  it("rolls the day over at local midnight, not UTC midnight", () => {
    // 2026-09-12T19:30:00Z is 2026-09-13 00:30 in Almaty (UTC+5). Deriving the day from UTC
    // would report the 12th and corrupt streaks and the calendar heatmap.
    expect(dayKeyOf(Date.UTC(2026, 8, 12, 19, 30))).toBe("2026-09-13");
    // 18:30Z is still 23:30 local on the 12th.
    expect(dayKeyOf(Date.UTC(2026, 8, 12, 18, 30))).toBe("2026-09-12");
  });

  it("adds and subtracts days across a month boundary", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-09-01", -1)).toBe("2026-08-31");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("handles a leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
  });

  it("measures distance between days", () => {
    expect(daysBetween("2026-09-01", "2026-09-08")).toBe(7);
    expect(daysBetween("2026-09-08", "2026-09-01")).toBe(-7);
    expect(daysBetween("2026-09-01", "2026-09-01")).toBe(0);
  });

  it.each([
    ["2026-09-12", true],
    ["2026-02-30", false],
    ["2026-13-01", false],
    ["26-09-12", false],
    ["not-a-date", false],
  ])("isDayKey(%s) === %s", (value, expected) => {
    expect(isDayKey(value)).toBe(expected);
  });
});
