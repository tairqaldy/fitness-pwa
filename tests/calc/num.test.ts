import { describe, expect, it } from "vitest";

import {
  clamp,
  fromGrams,
  GRAMS_PER_KG,
  isFiniteNum,
  isNonNeg,
  isNonNegInt,
  isPos,
  isPosInt,
  roundHalfUp,
  toGrams,
  WEIGHT_EPSILON_KG,
  weightGte,
  weightLt,
  weightsEqual,
} from "@/lib/calc";

describe("the guard primitives", () => {
  it.each([
    ["a plain number", 1, true],
    ["zero", 0, true],
    ["a negative", -1, true],
    ["NaN", Number.NaN, false],
    ["Infinity", Number.POSITIVE_INFINITY, false],
    ["-Infinity", Number.NEGATIVE_INFINITY, false],
    ["a numeric string", "1", false],
    ["null", null, false],
    ["undefined", undefined, false],
  ])("isFiniteNum(%s)", (_label, value, expected) => {
    expect(isFiniteNum(value)).toBe(expected);
  });

  it.each([
    [1, true],
    [0.5, true],
    [0, false],
    [-1, false],
    [Number.NaN, false],
  ])("isPos(%s)", (value, expected) => {
    expect(isPos(value)).toBe(expected);
  });

  it.each([
    [0, true],
    [1, true],
    [-0.5, false],
    [Number.NaN, false],
  ])("isNonNeg(%s)", (value, expected) => {
    expect(isNonNeg(value)).toBe(expected);
  });

  it.each([
    [1, true],
    [12, true],
    [0, false],
    [-3, false],
    [2.5, false],
    [Number.NaN, false],
    [Number.POSITIVE_INFINITY, false],
  ])("isPosInt(%s)", (value, expected) => {
    expect(isPosInt(value)).toBe(expected);
  });

  it.each([
    [0, true],
    [28, true],
    [-1, false],
    [13.5, false],
    [Number.NaN, false],
  ])("isNonNegInt(%s)", (value, expected) => {
    expect(isNonNegInt(value)).toBe(expected);
  });
});

describe("clamp", () => {
  it.each([
    ["inside the range", 5, 0, 10, 5],
    ["below the range", -5, 0, 10, 0],
    ["above the range", 15, 0, 10, 10],
    ["exactly at the low bound", 0, 0, 10, 0],
    ["exactly at the high bound", 10, 0, 10, 10],
  ])("%s", (_label, value, lo, hi, expected) => {
    expect(clamp(value, lo, hi)).toBe(expected);
  });

  it.each([
    ["inverted bounds", 5, 10, 0],
    ["a NaN value", Number.NaN, 0, 10],
    ["a non-finite low bound", 5, Number.NEGATIVE_INFINITY, 10],
    ["a non-finite high bound", 5, 0, Number.POSITIVE_INFINITY],
  ])("is null for %s", (_label, value, lo, hi) => {
    expect(clamp(value, lo, hi)).toBeNull();
  });
});

describe("weight comparison", () => {
  it("treats a sub-microgram difference as the same weight", () => {
    // Never compare weights with ===. A plate list summed in floats does not reproduce its target
    // bit-for-bit, and the symptom is a genuinely exact 102.0 kg set reporting +1e-13.
    expect(weightsEqual(102.0, 102.0 + 1e-13)).toBe(true);
    expect(weightsEqual(102.0, 102.001)).toBe(false);
    expect(WEIGHT_EPSILON_KG).toBe(1e-9);
  });

  it("is null-safe rather than coercing", () => {
    expect(weightsEqual(Number.NaN, 102)).toBe(false);
    expect(weightGte(Number.NaN, 102)).toBe(false);
    expect(weightLt(102, Number.NaN)).toBe(false);
  });

  it("weightGte tolerates a sub-epsilon shortfall", () => {
    expect(weightGte(25.0 - 1e-13, 25.0)).toBe(true);
    expect(weightGte(25.0, 25.0)).toBe(true);
    expect(weightGte(24.9, 25.0)).toBe(false);
  });

  it("weightLt requires a real difference", () => {
    expect(weightLt(24.9, 25.0)).toBe(true);
    expect(weightLt(25.0, 25.0)).toBe(false);
    expect(weightLt(25.0, 25.0 + 1e-13)).toBe(false);
  });
});

describe("roundHalfUp", () => {
  it("rounds a .5 boundary away from zero, not to even", () => {
    expect(roundHalfUp(0.5, 0)).toBe(1);
    expect(roundHalfUp(1.5, 0)).toBe(2);
    expect(roundHalfUp(2.5, 0)).toBe(3);
    expect(roundHalfUp(-0.5, 0)).toBe(-1);
    expect(roundHalfUp(-2.5, 0)).toBe(-3);
  });

  it("collapses float noise onto the boundary without moving a genuine sub-half value", () => {
    // 93.85 * 10 is not exactly 938.5 in doubles, and a naive Math.round would answer 93.8.
    expect(roundHalfUp(93.85, 1)).toBe(93.9);
    expect(roundHalfUp(93.84999, 1)).toBe(93.8);
  });

  it("defaults to integer rounding", () => {
    expect(roundHalfUp(2.4)).toBe(2);
    expect(roundHalfUp(2.6)).toBe(3);
  });

  it("normalises a negative zero to zero", () => {
    expect(roundHalfUp(-0.0001, 2)).toBe(0);
    expect(Object.is(roundHalfUp(-0.0001, 2), -0)).toBe(false);
  });

  it.each([
    ["NaN", Number.NaN, 1],
    ["Infinity", Number.POSITIVE_INFINITY, 1],
    ["a fractional dp", 1.234, 1.5],
    ["a negative dp", 1.234, -1],
    ["a dp beyond 12", 1.234, 13],
  ])("is null for %s", (_label, x, dp) => {
    expect(roundHalfUp(x, dp)).toBeNull();
  });

  it("is null when scaling would overflow to Infinity", () => {
    expect(roundHalfUp(1e308, 12)).toBeNull();
  });
});

describe("toGrams / fromGrams", () => {
  it("round-trips every plate denomination exactly", () => {
    for (const kg of [0.25, 0.5, 1.25, 2.5, 5, 10, 15, 20, 25, 87.5, 101.9]) {
      expect(fromGrams(toGrams(kg) as number)).toBe(kg);
    }
  });

  it("produces integers, which is the whole point", () => {
    expect(toGrams(1.25)).toBe(1250);
    expect(toGrams(0.5)).toBe(500);
    expect(Number.isInteger(toGrams(101.9) as number)).toBe(true);
    expect(GRAMS_PER_KG).toBe(1000);
  });

  it("is null when the value cannot be an exact integer number of grams", () => {
    expect(toGrams(1e15)).toBeNull();
    expect(toGrams(Number.NaN)).toBeNull();
    expect(fromGrams(1.5)).toBeNull();
    expect(fromGrams(Number.NaN)).toBeNull();
  });
});
