import { describe, expect, it } from "vitest";

import {
  brzycki,
  e1rm,
  e1rmFromRpe,
  epley,
  MAX_REPS_FOR_E1RM,
  RPE_INFLATION_CAP,
} from "@/lib/calc";

import { COMPOSITE_VECTORS, E1RM_VECTORS, R6_UNCAPPED_KG } from "./fixtures/r09-vectors";

describe("epley", () => {
  it.each(E1RM_VECTORS)("%s: epley(%d, %d)", (_label, weightKg, reps, expected) => {
    expect(epley(weightKg, reps)).toBeCloseTo(expected, 4);
  });

  it("is NOT w at one rep -- r09 corrects the brief here", () => {
    // The brief claims both formulas return w at r = 1. Epley returns 1.0333 * w, and Epley is
    // correct as published (Wikipedia scopes it to r > 1). Short-circuiting r = 1 is `e1rm`'s job.
    expect(epley(100, 1)).toBeCloseTo(103.333333, 4);
    expect(epley(100, 1)).not.toBeCloseTo(100, 4);
  });
});

describe("brzycki", () => {
  it.each(E1RM_VECTORS)("%s: brzycki(%d, %d)", (_label, weightKg, reps, _e, expected) => {
    const actual = brzycki(weightKg, reps);
    if (expected === null) expect(actual).toBeNull();
    else expect(actual).toBeCloseTo(expected, 4);
  });

  it("uses 37 - reps as the denominator, not 36 - reps", () => {
    // The classic off-by-one-rep bug. 36 - 5 = 31 gives 116.129, which is Brzycki's *correct* value
    // at 6 reps -- so the whole curve shifts by one rep and every printed number stays plausible.
    expect(brzycki(100, 5)).toBe(112.5);
    expect(brzycki(100, 5)).not.toBeCloseTo(116.129032, 4);
    expect(brzycki(100, 6)).toBeCloseTo(116.129032, 4);
  });

  it("returns w exactly at one rep", () => {
    expect(brzycki(100, 1)).toBe(100);
  });

  it("is absurd but finite at 36 reps, and null at the pole and beyond", () => {
    // 3600 kg would be persisted and would poison max(e1rm) for that lift forever, which is why
    // `e1rm` suppresses everything above 12 reps rather than trusting this number.
    expect(brzycki(100, 36)).toBeCloseTo(3600, 4);
    expect(brzycki(100, 37)).toBeNull();
    expect(brzycki(100, 38)).toBeNull();
  });
});

describe("the Epley / Brzycki crossover", () => {
  it.each([2, 3, 4, 5, 6, 7, 8, 9])("Epley is strictly higher at %d reps", (reps) => {
    const e = epley(100, reps);
    const b = brzycki(100, reps);
    expect(e).not.toBeNull();
    expect(b).not.toBeNull();
    expect(e as number).toBeGreaterThan(b as number);
  });

  it.each([11, 12])("Brzycki is strictly higher at %d reps", (reps) => {
    const e = epley(100, reps);
    const b = brzycki(100, reps);
    expect(b as number).toBeGreaterThan(e as number);
  });

  it("agrees at 10 reps to within float noise, and equals 4/3 * w", () => {
    // r09 proposes asserting exact `===` here. That claim does not hold in IEEE-754: the formulas
    // are algebraically identical at 10 reps (4/3) but are evaluated in different orders, so
    // `w * (1 + 10/30)` and `(w * 36) / 27` differ by 2.8e-14 at w = 100, with Brzycki on top.
    // See the report; `e1rm` compares them with the weight epsilon for exactly this reason.
    for (const w of [1, 0.5, 82.5, 100, 140, 222.75]) {
      const e = epley(w, 10) as number;
      const b = brzycki(w, 10) as number;
      expect(e).toBeCloseTo((4 / 3) * w, 10);
      expect(b).toBeCloseTo((4 / 3) * w, 10);
      expect(e).toBeCloseTo(b, 10);
    }
  });
});

describe("e1rm formula guards", () => {
  it.each([
    ["zero weight (bodyweight set)", 0, 5],
    ["negative weight", -5, 5],
    ["NaN weight", Number.NaN, 5],
    ["Infinite weight", Number.POSITIVE_INFINITY, 5],
    ["fractional reps", 100, 2.5],
    ["zero reps", 100, 0],
    ["negative reps", 100, -3],
  ])("rejects %s", (_label, weightKg, reps) => {
    expect(epley(weightKg, reps)).toBeNull();
    expect(brzycki(weightKg, reps)).toBeNull();
    expect(e1rm(weightKg, reps)).toBeNull();
    expect(e1rmFromRpe(weightKg, reps, 8)).toBeNull();
  });
});

describe("e1rmFromRpe", () => {
  it("inverts the chart percentage", () => {
    expect(e1rmFromRpe(100, 5, 8)).toBeCloseTo(123.304562, 4);
  });

  it("is null when the chart has no cell", () => {
    expect(e1rmFromRpe(100, 12, 6)).toBeNull();
    expect(e1rmFromRpe(100, 5, 5.5)).toBeNull();
  });
});

describe("e1rm", () => {
  it("V1: a single to failure IS the 1RM", () => {
    // Without this guard Epley's 103.333 manufactures a 3.3% fake PR the first time the user logs a
    // true single -- the highest-probability real bug in the whole module.
    expect(e1rm(100, 1)).toEqual({ kg: 100, source: "actual_single" });
    expect(e1rm(100, 1, null)).toEqual({ kg: 100, source: "actual_single" });
    expect(e1rm(100, 1, 10)).toEqual({ kg: 100, source: "actual_single" });
  });

  it.each([
    ["V3 the crossover attributes to Epley, not float noise", 100, 10, 133.333333, "epley"],
    ["V4 Brzycki takes over above 10 reps", 100, 12, 144.0, "brzycki"],
    ["V5", 100, 6, 120.0, "epley"],
  ])("%s", (_label, weightKg, reps, expectedKg, expectedSource) => {
    const actual = e1rm(weightKg, reps);
    expect(actual?.kg).toBeCloseTo(expectedKg, 4);
    expect(actual?.source).toBe(expectedSource);
  });

  it.each([
    ["V6 the pole", 37],
    ["the absurd-but-finite 3600 kg value", 36],
    ["one rep past the display ceiling", 13],
  ])("suppresses the readout: %s", (_label, reps) => {
    expect(e1rm(100, reps)).toBeNull();
  });

  it("suppresses exactly above MAX_REPS_FOR_E1RM, not at it", () => {
    expect(e1rm(100, MAX_REPS_FOR_E1RM)).not.toBeNull();
    expect(e1rm(100, MAX_REPS_FOR_E1RM + 1)).toBeNull();
  });

  it.each(COMPOSITE_VECTORS)("%s", (_label, weightKg, reps, rpe, expectedKg, expectedSource) => {
    const actual = e1rm(weightKg, reps, rpe);
    expect(actual?.kg).toBeCloseTo(expectedKg, 4);
    expect(actual?.source).toBe(expectedSource);
  });

  it("R6: the inflation cap is what stops an unbeatable PR", () => {
    // Uncapped, one optimistic RPE on a high-rep back-off set sets a permanent PR and flattens the
    // progression chart for that lift forever.
    const actual = e1rm(100, 12, 8);
    expect(actual?.kg).toBeCloseTo(158.4, 4);
    expect(actual?.kg).toBeLessThan(R6_UNCAPPED_KG);
    expect(actual?.kg).toBeCloseTo(144.0 * RPE_INFLATION_CAP, 4);
  });

  it("ignores a non-finite RPE rather than failing the set", () => {
    expect(e1rm(100, 5, Number.NaN)).toEqual(e1rm(100, 5));
  });

  it("scales linearly with load, which is why a lb-as-kg slip is unbeatable", () => {
    const light = e1rm(100, 5, 8);
    const heavy = e1rm(200, 5, 8);
    expect(heavy?.kg).toBeCloseTo((light?.kg ?? 0) * 2, 4);
  });

  // Documented omission: no test asserts the winner at reps = 7. Epley's implied %1RM there is
  // 30/37 = 81.0811 against the chart's 81.1 -- a margin of 0.024 kg on a 100 kg set, which is
  // float noise dressed up as a finding (r09 section 2 says so explicitly). The winner is asserted
  // at 6 reps (Epley, 0.37pp margin) and 8 reps (RPE, 0.35pp margin) instead, via R3 and V5.
});
