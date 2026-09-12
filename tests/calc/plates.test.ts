import { describe, expect, it } from "vitest";

import { achievableTotals, minIncrementKg, plateMath, type PlateInventory } from "@/lib/calc";

import {
  BAR_KG,
  GYM_INVENTORY,
  LATTICE_99_TO_105,
  MIN_INCREMENT_KG,
  P3_ROUND_DOWN,
  PLATE_VECTORS_NEAREST,
} from "./fixtures/r09-vectors";

describe("minIncrementKg", () => {
  it("is twice the smallest plate, not the smallest plate", () => {
    // Every "why can't I load 101.5?" is this. With 0.5 kg plates the bar steps 1.0 kg.
    expect(minIncrementKg(GYM_INVENTORY)).toBe(MIN_INCREMENT_KG);
  });

  it("ignores denominations with no usable pair", () => {
    expect(
      minIncrementKg([
        [25, 2],
        [1.25, 0],
      ]),
    ).toBe(50);
  });

  it("is null when nothing is loadable", () => {
    expect(minIncrementKg([])).toBeNull();
    expect(minIncrementKg([[25, 0]])).toBeNull();
  });

  it("is null for a malformed inventory", () => {
    expect(minIncrementKg([[0, 2]])).toBeNull();
    expect(minIncrementKg([[25, Number.NaN]])).toBeNull();
    expect(minIncrementKg(null as unknown as PlateInventory)).toBeNull();
  });
});

describe("plateMath -- nearest (default)", () => {
  it.each(PLATE_VECTORS_NEAREST)(
    "%s: target %d kg",
    (_label, targetKg, platesPerSide, achievedKg, errorKg, status) => {
      const actual = plateMath(targetKg, BAR_KG, GYM_INVENTORY);
      expect(actual).not.toBeNull();
      expect(actual?.platesPerSide).toEqual([...platesPerSide]);
      expect(actual?.achievedKg).toBe(achievedKg);
      expect(actual?.errorKg).toBe(errorKg);
      expect(actual?.status).toBe(status);
    },
  );

  it("P3: nearest beats greedy round-down by 9x", () => {
    // Greedy is round-down-only, so on a +2.5 kg progression step its -0.9 kg error eats 36% of the
    // increment. The lattice finds 102.0, which is 0.1 away.
    const nearest = plateMath(101.9, BAR_KG, GYM_INVENTORY);
    const down = plateMath(101.9, BAR_KG, GYM_INVENTORY, "roundDown");
    expect(Math.abs(nearest?.errorKg ?? 0)).toBeCloseTo(0.1, 9);
    expect(Math.abs(down?.errorKg ?? 0)).toBeCloseTo(0.9, 9);
    expect(Math.abs(down?.errorKg ?? 0) / Math.abs(nearest?.errorKg ?? 1)).toBeCloseTo(9, 6);
  });

  it("breaks a tie upward, because progressive overload wants the tie that progresses", () => {
    const actual = plateMath(102.25, BAR_KG, GYM_INVENTORY);
    expect(actual?.achievedKg).toBe(102.5);
    expect(actual?.errorKg).toBe(0.25);
  });

  it("prefers the fewest plates, then the heavier plate on the outside", () => {
    // 41 kg per side is reachable as [25, 15, 0.5, 0.5] or [20, 20, 0.5, 0.5]. Same count, so the
    // lexicographically larger descending list wins.
    const actual = plateMath(102.0, BAR_KG, GYM_INVENTORY);
    expect(actual?.platesPerSide).toEqual([25, 15, 0.5, 0.5]);
    expect(actual?.platesPerSide).not.toEqual([20, 20, 0.5, 0.5]);
  });
});

describe("plateMath -- roundDown", () => {
  it("P3 takes the greatest loadable weight at or below the target", () => {
    const actual = plateMath(P3_ROUND_DOWN.targetKg, BAR_KG, GYM_INVENTORY, "roundDown");
    expect(actual?.platesPerSide).toEqual([...P3_ROUND_DOWN.platesPerSide]);
    expect(actual?.achievedKg).toBe(P3_ROUND_DOWN.achievedKg);
    expect(actual?.errorKg).toBe(P3_ROUND_DOWN.errorKg);
    expect(actual?.status).toBe("ROUNDED");
  });

  it("never exceeds the target", () => {
    for (const target of [20.5, 33.3, 47.9, 88.8, 101.9, 140.4]) {
      const actual = plateMath(target, BAR_KG, GYM_INVENTORY, "roundDown");
      expect(actual?.achievedKg).toBeLessThanOrEqual(target);
      expect(actual?.errorKg).toBeLessThanOrEqual(0);
    }
  });
});

describe("the achievable lattice", () => {
  it("steps 1.0 kg: 100.5 and 101.5 do not exist", () => {
    const totals = achievableTotals(BAR_KG, GYM_INVENTORY);
    expect(totals).not.toBeNull();
    const inRange = [...(totals as Map<number, number[]>).keys()]
      .map((grams) => grams / 1000)
      .filter((kg) => kg >= 99 && kg <= 105)
      .sort((a, b) => a - b);
    expect(inRange).toEqual(LATTICE_99_TO_105);
    expect(inRange).not.toContain(100.5);
    expect(inRange).not.toContain(101.5);
  });

  it("always contains the empty bar", () => {
    const totals = achievableTotals(BAR_KG, GYM_INVENTORY);
    expect((totals as Map<number, number[]>).get(20_000)).toEqual([]);
  });

  it("refuses an inventory large enough to hang a render", () => {
    // A nonsense pair count must answer, not enumerate 10^5+ combinations inside a render.
    expect(achievableTotals(BAR_KG, [[25, 100_000]])).toBeNull();
    expect(plateMath(100, BAR_KG, [[25, 100_000]])).toBeNull();
  });

  it.each([
    ["a non-finite bar", Number.NaN],
    ["a zero bar", 0],
    ["a negative bar", -20],
  ])("is null for %s", (_label, barKg) => {
    expect(achievableTotals(barKg, GYM_INVENTORY)).toBeNull();
  });

  it("is null for a plate weight too large to express in safe integer grams", () => {
    expect(achievableTotals(BAR_KG, [[1e15, 1]])).toBeNull();
  });

  it("is null for a bar weight too large to express in safe integer grams", () => {
    expect(achievableTotals(1e15, GYM_INVENTORY)).toBeNull();
    expect(plateMath(1e15 + 100, 1e15, GYM_INVENTORY)).toBeNull();
  });
});

describe("plateMath -- integer-gram exactness", () => {
  it("hits a microplate target exactly, with no float residue", () => {
    // The float-drift symptom is a 42.5 kg set reporting a 1e-13 error and failing EXACT.
    const actual = plateMath(42.5, BAR_KG, GYM_INVENTORY);
    expect(actual?.achievedKg).toBe(42.5);
    expect(actual?.errorKg).toBe(0);
    expect(actual?.status).toBe("EXACT");
    expect(actual?.platesPerSide).toEqual([10, 1.25]);
  });

  it("sums 2.5 + 1.25 + 0.5 to exactly 4.25 per side", () => {
    // The list r09's risk table names: three plates whose naive float sum accumulates error.
    const actual = plateMath(28.5, BAR_KG, GYM_INVENTORY);
    expect(actual?.platesPerSide).toEqual([2.5, 1.25, 0.5]);
    expect(actual?.achievedKg).toBe(28.5);
    expect(BAR_KG + 2 * (actual?.platesPerSide ?? []).reduce((s, p) => s + p, 0)).toBeCloseTo(
      28.5,
      9,
    );
  });
});

describe("plateMath -- statuses", () => {
  it("BELOW_BAR returns the bar, never negative plates and never a blank screen", () => {
    const actual = plateMath(15.0, BAR_KG, GYM_INVENTORY);
    expect(actual).toEqual({
      status: "BELOW_BAR",
      platesPerSide: [],
      achievedKg: 20.0,
      errorKg: 5.0,
    });
  });

  it("NO_INVENTORY when there is nothing to load", () => {
    for (const inv of [[] as PlateInventory, [[25, 0]] as PlateInventory]) {
      const actual = plateMath(100, BAR_KG, inv);
      expect(actual?.status).toBe("NO_INVENTORY");
      expect(actual?.platesPerSide).toEqual([]);
      expect(actual?.achievedKg).toBe(20.0);
      expect(actual?.errorKg).toBe(-80);
    }
  });

  it("EXACT with no inventory when the target IS the bar", () => {
    const actual = plateMath(20.0, BAR_KG, []);
    expect(actual?.status).toBe("EXACT");
    expect(actual?.errorKg).toBe(0);
  });

  it("BELOW_BAR wins over NO_INVENTORY -- the actionable advice is a lighter bar", () => {
    expect(plateMath(15.0, BAR_KG, [])?.status).toBe("BELOW_BAR");
  });
});

describe("plateMath -- inventory semantics", () => {
  it("stores pairs, not loose plates", () => {
    // Three 10 kg plates is one usable pair, because a barbell must be loaded symmetrically.
    const actual = plateMath(40.0, BAR_KG, [[10, 1]]);
    expect(actual?.platesPerSide).toEqual([10]);
    expect(actual?.achievedKg).toBe(40.0);
    expect(actual?.status).toBe("EXACT");
  });

  it("floors a fractional pair count", () => {
    expect(plateMath(40.0, BAR_KG, [[10, 1.9]])?.achievedKg).toBe(40.0);
    expect(plateMath(60.0, BAR_KG, [[10, 1.9]])?.achievedKg).toBe(40.0);
  });

  it("honours a 15 kg bar", () => {
    // Specialty bars run 10-25 kg, so barKg is per-exercise and never one global setting.
    const actual = plateMath(55.0, 15.0, GYM_INVENTORY);
    expect(actual?.platesPerSide).toEqual([20]);
    expect(actual?.achievedKg).toBe(55.0);
    expect(actual?.status).toBe("EXACT");
  });
});

describe("plateMath guards", () => {
  it.each([
    ["a non-finite target", Number.NaN, BAR_KG],
    ["an Infinite target", Number.POSITIVE_INFINITY, BAR_KG],
    ["a zero bar", 100, 0],
    ["a negative bar", 100, -20],
  ])("is null for %s", (_label, targetKg, barKg) => {
    expect(plateMath(targetKg, barKg, GYM_INVENTORY)).toBeNull();
  });

  it("is null for a target too large to express in safe integer grams", () => {
    expect(plateMath(1e15, BAR_KG, GYM_INVENTORY)).toBeNull();
  });

  it("is null for a malformed inventory", () => {
    expect(plateMath(100, BAR_KG, [[0, 2]])).toBeNull();
    expect(plateMath(100, BAR_KG, null as unknown as PlateInventory)).toBeNull();
  });
});
