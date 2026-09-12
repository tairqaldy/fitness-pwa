import { describe, expect, it } from "vitest";

import en from "../messages/en.json";
import ru from "../messages/ru.json";
import { DEFAULT_LOCALE, isLocale, LOCALES } from "@/i18n/config";
import { APP_TIME_ZONE } from "@/lib/time";

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

describe("app timezone", () => {
  it("is pinned to Asia/Almaty", () => {
    // The rest of the calendar arithmetic lives in src/lib/calc/time.ts and is covered by
    // tests/calc/time.test.ts. Only the pinning contract is asserted here.
    expect(APP_TIME_ZONE).toBe("Asia/Almaty");
  });
});
