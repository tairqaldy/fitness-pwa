import { describe, expect, it } from "vitest";

import {
  WARMUP_MAX_STEPS,
  WARMUP_MIN_ABOVE_BAR_KG,
  WARMUP_RAMP,
  warmupSets,
  type PlateInventory,
} from "@/lib/calc";

import {
  BAR_KG,
  GYM_INVENTORY,
  WARMUP_TRAINING_MAX_BUG_KG,
  WARMUP_W1,
  WARMUP_W2,
} from "./fixtures/r09-vectors";

describe("warmupSets -- W1, a 100 kg top working set", () => {
  const steps = warmupSets(100.0, BAR_KG, GYM_INVENTORY);

  it("produces all three ramp steps", () => {
    expect(steps).toHaveLength(3);
  });

  it.each(WARMUP_W1)("%d%% x %d lands on %d kg", (pct, reps, rawKg, weightKg, platesPerSide) => {
    const step = (steps ?? []).find((s) => s.pct === pct);
    expect(step?.reps).toBe(reps);
    expect(step?.rawKg).toBeCloseTo(rawKg, 9);
    expect(step?.weightKg).toBe(weightKg);
    expect(step?.platesPerSide).toEqual([...platesPerSide]);
  });
});

describe("warmupSets -- W2, an 87.5 kg top working set", () => {
  const steps = warmupSets(87.5, BAR_KG, GYM_INVENTORY);

  it.each(WARMUP_W2)(
    "%d%% x %d asks for %d kg and loads %d kg",
    (pct, reps, rawKg, weightKg, platesPerSide) => {
      const step = (steps ?? []).find((s) => s.pct === pct);
      expect(step?.reps).toBe(reps);
      expect(step?.rawKg).toBeCloseTo(rawKg, 9);
      expect(step?.weightKg).toBe(weightKg);
      expect(step?.platesPerSide).toEqual([...platesPerSide]);
    },
  );

  it("rounds the unloadable middle step DOWN, by 0.25 kg", () => {
    // 43.75 kg needs 11.875 per side; the lattice steps 1.0 kg, so only 43.5 and 44.5 exist. A
    // warm-up must never exceed its prescription.
    const middle = (steps ?? []).find((s) => s.pct === 0.5);
    expect(middle?.weightKg).toBe(43.5);
    expect((middle?.weightKg ?? 0) - (middle?.rawKg ?? 0)).toBeCloseTo(-0.25, 9);
  });
});

describe("warmupSets provenance", () => {
  it("takes percentages of the working weight, not of a Training Max", () => {
    // Wendler's 40/50/60 are of the Training Max, about 90% of 1RM. "Correcting" this calculator by
    // dividing by 0.9 would make step one 44.4 kg instead of 40.0 -- every warm-up 11% heavier.
    const first = warmupSets(100.0, BAR_KG, GYM_INVENTORY)?.[0];
    expect(first?.weightKg).toBe(40.0);
    expect(first?.weightKg).not.toBeCloseTo(WARMUP_TRAINING_MAX_BUG_KG, 1);
  });

  it("ships the 40/50/60 x 5/5/3 ramp", () => {
    expect(WARMUP_RAMP.map((s) => s.pct)).toEqual([0.4, 0.5, 0.6]);
    expect(WARMUP_RAMP.map((s) => s.reps)).toEqual([5, 5, 3]);
  });
});

describe("warmupSets invariants", () => {
  it("never exceeds its raw prescription, at any working weight", () => {
    for (let working = 40; working <= 200; working += 2.5) {
      const steps = warmupSets(working, BAR_KG, GYM_INVENTORY);
      expect(steps).not.toBeNull();
      for (const step of steps ?? []) {
        expect(step.weightKg).toBeLessThanOrEqual(step.rawKg);
      }
    }
  });

  it("keeps every step strictly below the working weight and clear of the bar", () => {
    for (let working = 40; working <= 200; working += 2.5) {
      for (const step of warmupSets(working, BAR_KG, GYM_INVENTORY) ?? []) {
        expect(step.weightKg).toBeLessThan(working);
        expect(step.weightKg).toBeGreaterThanOrEqual(BAR_KG + WARMUP_MIN_ABOVE_BAR_KG);
      }
    }
  });
});

describe("warmupSets -- collapsed ramps", () => {
  it.each([
    ["40 kg: 40% of it is below the bar", 40.0],
    ["the empty bar itself", 20.0],
    ["lighter than the bar", 15.0],
  ])("returns [] for %s", (_label, topWorkingKg) => {
    // Without the filter this renders three identical "20.0 kg" rows, which reads as a broken
    // calculator. The empty-bar set every lifter should still do is a UI concern, not a ramp step.
    expect(warmupSets(topWorkingKg, BAR_KG, GYM_INVENTORY)).toEqual([]);
  });

  it("returns [] when nothing can be loaded", () => {
    expect(warmupSets(100.0, BAR_KG, [])).toEqual([]);
    expect(warmupSets(100.0, BAR_KG, [[25, 0]])).toEqual([]);
  });

  it("drops only the steps that collapse, keeping the rest", () => {
    // 50 kg: 40% is 20.0 (the bare bar, dropped); 50% and 60% survive.
    const steps = warmupSets(50.0, BAR_KG, GYM_INVENTORY);
    expect(steps?.map((s) => s.weightKg)).toEqual([25.0, 30.0]);
  });
});

describe("warmupSets -- a custom ramp", () => {
  it("honours a caller-supplied ramp so it can live in settings", () => {
    const steps = warmupSets(100.0, BAR_KG, GYM_INVENTORY, [
      { pct: 0.5, reps: 5 },
      { pct: 0.7, reps: 3 },
      { pct: 0.85, reps: 1 },
    ]);
    expect(steps?.map((s) => s.weightKg)).toEqual([50.0, 70.0, 85.0]);
    expect(steps?.map((s) => s.reps)).toEqual([5, 3, 1]);
  });

  it("returns [] for an empty ramp rather than inventing one", () => {
    expect(warmupSets(100.0, BAR_KG, GYM_INVENTORY, [])).toEqual([]);
  });

  it("drops a 100% step, because a warm-up at the working weight is a working set", () => {
    // The only way a rounded-down step can reach the working weight is a ramp entry at pct 1.0, and
    // the filter has to exclude it or the ramp ends with a duplicate of the top set.
    expect(warmupSets(100.0, BAR_KG, GYM_INVENTORY, [{ pct: 1, reps: 1 }])).toEqual([]);
    expect(
      warmupSets(100.0, BAR_KG, GYM_INVENTORY, [
        { pct: 0.6, reps: 3 },
        { pct: 1, reps: 1 },
      ])?.map((s) => s.weightKg),
    ).toEqual([60.0]);
  });

  it.each([
    ["too many steps", new Array(WARMUP_MAX_STEPS + 1).fill({ pct: 0.5, reps: 5 })],
    ["a zero percentage", [{ pct: 0, reps: 5 }]],
    ["a percentage above 100%", [{ pct: 1.2, reps: 5 }]],
    ["a non-finite percentage", [{ pct: Number.NaN, reps: 5 }]],
    ["fractional reps", [{ pct: 0.5, reps: 2.5 }]],
    ["zero reps", [{ pct: 0.5, reps: 0 }]],
  ])("is null for a ramp with %s", (_label, ramp) => {
    expect(warmupSets(100.0, BAR_KG, GYM_INVENTORY, ramp)).toBeNull();
  });

  it("is null for a ramp that is not an array", () => {
    expect(
      warmupSets(100.0, BAR_KG, GYM_INVENTORY, null as unknown as typeof WARMUP_RAMP),
    ).toBeNull();
  });
});

describe("warmupSets guards", () => {
  it.each([
    ["a non-finite working weight", Number.NaN, BAR_KG],
    ["a zero working weight", 0, BAR_KG],
    ["a negative working weight", -100, BAR_KG],
    ["a zero bar", 100, 0],
  ])("is null for %s", (_label, topWorkingKg, barKg) => {
    expect(warmupSets(topWorkingKg, barKg, GYM_INVENTORY)).toBeNull();
  });

  it("is null when the inventory is malformed, not silently empty", () => {
    expect(warmupSets(100.0, BAR_KG, [[0, 2]])).toBeNull();
    expect(warmupSets(100.0, BAR_KG, null as unknown as PlateInventory)).toBeNull();
  });
});
