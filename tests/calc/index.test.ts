import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import * as calc from "@/lib/calc";

const CALC_DIR = join(import.meta.dirname, "..", "..", "src", "lib", "calc");

describe("the @/lib/calc barrel", () => {
  it("re-exports every module in the directory", () => {
    // `energy` is the one deliberate exception: `tdee` re-exports it, so listing it here as well
    // would be a duplicate star export. The assertion below proves its contents still arrive.
    const modules = readdirSync(CALC_DIR)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => f.replace(/\.ts$/, ""))
      .filter((m) => m !== "index" && m !== "energy");

    const barrel = readdirSync(CALC_DIR).includes("index.ts");
    expect(barrel).toBe(true);

    for (const m of modules) {
      expect(calcSource()).toContain(`export * from "./${m}"`);
    }
  });

  it("exposes energy's functions through tdee", () => {
    expect(typeof calc.mifflinStJeor).toBe("function");
    expect(typeof calc.katchMcArdle).toBe("function");
    expect(typeof calc.applyActivityFactor).toBe("function");
  });

  it("exposes one entry point for every calculator the spec names", () => {
    // One import path matters beyond tidiness: the same arithmetic runs in the weekly Cron batch and
    // in the client's Dexie replay, and both must agree bit-for-bit.
    for (const name of [
      "epley",
      "brzycki",
      "e1rmFromRpe",
      "e1rm",
      "nRM",
      "pct1RM",
      "rirFromRpe",
      "rpeFromRir",
      "navyBodyFatPct",
      "leanMassKg",
      "emaStep",
      "trendWeight",
      "tdeeFromEnergyBalance",
      "adaptiveTdee",
      "minIncrementKg",
      "achievableTotals",
      "plateMath",
      "warmupSets",
      "isCountedSet",
      "isHardSet",
      "setVolumeKg",
      "totalVolumeKg",
      "volumeByMuscle",
      "hardSetsByMuscle",
      "setsInRolling7d",
      "rolling7dVolumeKg",
      "almatyOffsetMinutes",
      "localDateFromInstant",
      "startOfLocalDayMs",
      "endOfLocalDayMs",
      "dayIndex",
      "diffDays",
      "rolling7dWindow",
      "roundHalfUp",
      "toGrams",
      "fromGrams",
    ]) {
      expect(typeof calc[name as keyof typeof calc]).toBe("function");
    }
  });

  it("performs no I/O and imports nothing from the app shell", () => {
    // The purity gate. A `next/*`, drizzle or D1 import here would make the calculators unusable on
    // the client and untestable without a runtime.
    const source = calcSource();
    expect(source).not.toMatch(/from "(@\/db|@\/server|next\/|drizzle-orm|dexie)/);
    expect(source).not.toMatch(/\bfetch\(/);
  });

  it("reads no ambient clock and throws nothing", () => {
    const source = calcSource();
    expect(source).not.toMatch(/Date\.now\(/);
    expect(source).not.toMatch(/new Date\(\)/);
    expect(source).not.toMatch(/toLocaleString/);
    // One error policy: null is the only failure channel, so a throw would be a second one.
    expect(source).not.toMatch(/^\s*throw /m);
  });

  it("contains no imperial Navy body-fat constants", () => {
    // Fed centimetres, the inch equation reads 6.52 percentage points high. It must not exist here
    // at all, so that no refactor can reach for it.
    const source = calcSource();
    expect(source).not.toContain("86.010");
    expect(source).not.toContain("70.041");
    expect(source).not.toContain("163.205");
  });
});

/** Every line of source under `src/lib/calc`, concatenated, for the purity greps above. */
function calcSource(): string {
  return readdirSync(CALC_DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => readFileSync(join(CALC_DIR, f), "utf8"))
    .join("\n");
}
