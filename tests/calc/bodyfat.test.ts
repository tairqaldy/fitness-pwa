import { describe, expect, it } from "vitest";

import { leanMassKg, navyBodyFatPct } from "@/lib/calc";

import {
  M1_BODY,
  NAVY_FEMALE_VECTORS,
  NAVY_M1_THROUGH_INCH_EQUATION,
  NAVY_MALE_VECTORS,
} from "./fixtures/r09-vectors";

describe("navyBodyFatPct -- male, metric", () => {
  it.each(NAVY_MALE_VECTORS)("%s", (_label, waistCm, neckCm, heightCm, expected) => {
    expect(navyBodyFatPct("male", { waistCm, neckCm, heightCm })).toBeCloseTo(expected, 4);
  });

  it("ignores hipCm, which is meaningless for the male equation", () => {
    const withHip = navyBodyFatPct("male", {
      waistCm: 85,
      neckCm: 38,
      heightCm: 178,
      hipCm: 99,
    });
    expect(withHip).toBeCloseTo(16.436, 4);
  });
});

describe("navyBodyFatPct -- female, metric", () => {
  it.each(NAVY_FEMALE_VECTORS)("%s", (_label, waistCm, hipCm, neckCm, heightCm, expected) => {
    expect(navyBodyFatPct("female", { waistCm, hipCm, neckCm, heightCm })).toBeCloseTo(expected, 4);
  });
});

describe("navyBodyFatPct provenance", () => {
  it("ships the metric constants, not the inch ones", () => {
    // The 86.010 / -70.041 / +36.76 constants are for inches and at least one calculator site
    // labels them metric. Fed centimetres they read 6.52 percentage points high.
    const m1 = navyBodyFatPct("male", { waistCm: 85, neckCm: 38, heightCm: 178 });
    expect(m1).toBeCloseTo(16.436, 4);
    expect(m1).not.toBeCloseTo(NAVY_M1_THROUGH_INCH_EQUATION, 1);
    expect(NAVY_M1_THROUGH_INCH_EQUATION - (m1 as number)).toBeCloseTo(6.5195, 2);
  });

  it("uses log base 10, not the natural log", () => {
    // Math.log instead of Math.log10 drives the denominator negative and yields about -591%. It does
    // not throw, and the physiological gate is the only thing that would catch it -- as `null`, with
    // no hint as to why. So the positive result itself is the assertion.
    const m1 = navyBodyFatPct("male", { waistCm: 85, neckCm: 38, heightCm: 178 });
    expect(m1).not.toBeNull();
    expect(m1 as number).toBeGreaterThan(0);
  });
});

describe("navyBodyFatPct guards", () => {
  it("rejects waist - neck <= 0", () => {
    // Neck and waist swapped in the form. log10(0) is -Infinity and log10(negative) is NaN, and NaN
    // reaches D1 as NULL on one driver and "NaN" on another -- either way the chart grows a hole.
    expect(navyBodyFatPct("male", { waistCm: 38, neckCm: 38, heightCm: 178 })).toBeNull();
    expect(navyBodyFatPct("male", { waistCm: 30, neckCm: 38, heightCm: 178 })).toBeNull();
  });

  it("rejects waist + hip - neck <= 0 for a female", () => {
    expect(
      navyBodyFatPct("female", { waistCm: 10, hipCm: 10, neckCm: 30, heightCm: 165 }),
    ).toBeNull();
  });

  it("rejects a female measurement whose hip is missing entirely", () => {
    // A half-filled form must never be treated as hip = 0: that silently degrades to
    // log10(waist - neck) and produces a plausible-looking, completely wrong number.
    expect(navyBodyFatPct("female", { waistCm: 72, neckCm: 32, heightCm: 165 })).toBeNull();
  });

  it.each([
    ["hipCm null", null],
    ["hipCm zero", 0],
    ["a NaN hipCm", Number.NaN],
  ])("rejects a female measurement with %s", (_label, hipCm) => {
    expect(navyBodyFatPct("female", { waistCm: 72, neckCm: 32, heightCm: 165, hipCm })).toBeNull();
  });

  it.each([
    ["zero height", { waistCm: 85, neckCm: 38, heightCm: 0 }],
    ["NaN neck", { waistCm: 85, neckCm: Number.NaN, heightCm: 178 }],
    ["negative waist", { waistCm: -85, neckCm: 38, heightCm: 178 }],
    ["Infinite height", { waistCm: 85, neckCm: 38, heightCm: Number.POSITIVE_INFINITY }],
  ])("rejects %s", (_label, m) => {
    expect(navyBodyFatPct("male", m)).toBeNull();
  });

  it("rejects an unphysiological result rather than plotting it", () => {
    // Below 2% and above 60% are not bodies, they are bad tape measurements.
    expect(navyBodyFatPct("male", { waistCm: 39, neckCm: 38, heightCm: 178 })).toBeNull();
    expect(navyBodyFatPct("male", { waistCm: 300, neckCm: 30, heightCm: 178 })).toBeNull();
    expect(
      navyBodyFatPct("female", { waistCm: 40, hipCm: 41, neckCm: 80, heightCm: 165 }),
    ).toBeNull();
    expect(
      navyBodyFatPct("female", { waistCm: 300, hipCm: 300, neckCm: 30, heightCm: 165 }),
    ).toBeNull();
  });
});

describe("leanMassKg", () => {
  it("computes M1's lean mass on an 82 kg body", () => {
    expect(leanMassKg(M1_BODY.weightKg, M1_BODY.bodyFatPct)).toBeCloseTo(M1_BODY.leanMassKg, 6);
  });

  it.each([
    ["100% fat is not a body", 82, 100],
    ["negative body fat", 82, -1],
    ["zero weight", 0, 20],
    ["NaN body fat", 82, Number.NaN],
  ])("rejects %s", (_label, kg, pct) => {
    expect(leanMassKg(kg, pct)).toBeNull();
  });

  it("accepts 0% body fat as a boundary, not an error", () => {
    expect(leanMassKg(82, 0)).toBe(82);
  });
});
