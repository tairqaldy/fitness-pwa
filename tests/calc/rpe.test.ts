import { describe, expect, it } from "vitest";

import { NRM, NRM_MAX_K, nRM, pct1RM, rirFromRpe, roundHalfUp, rpeFromRir } from "@/lib/calc";

import { NRM_CELLS, PCT1RM_GRID, PCT1RM_OFF_TABLE } from "./fixtures/r09-vectors";

describe("NRM", () => {
  it("pins the chart identity so the linearised chart cannot be swapped in", () => {
    // A widely circulated chart starts its RPE-10 row 100 / 97.5 / 95 -- a linearised 2.5%-per-step
    // grid, not the RTS chart. It would inflate e1RM by up to 4 percentage points of %1RM. This
    // single assertion is what a future "chart update" PR has to get past.
    expect(NRM[2]).toBe(95.5);
    expect(NRM[2]).not.toBe(97.5);
  });

  it("has 14 attested entries plus the unused index 0", () => {
    expect(NRM).toHaveLength(NRM_MAX_K + 1);
  });
});

describe("nRM", () => {
  it.each(NRM_CELLS)("k = %d reads %d exactly", (k, expected) => {
    expect(nRM(k)).toBe(expected);
  });

  it.each([
    [1.5, 97.8],
    [6.5, 82.4],
    [13.5, 64.0],
  ])("k = %d is the half-up mean of its neighbours: %d", (k, expected) => {
    // 1.5 is the load-bearing one: (100 + 95.5) / 2 = 97.75, and half-to-even would give 97.8 here
    // but 93.8 / 79.8 / 69.3 elsewhere. See the roundHalfUp test below.
    expect(nRM(k)).toBe(expected);
  });

  it.each([
    ["below the table", 0],
    ["below the table, on the half grid", 0.5],
    ["half a rep past the last attested cell", 14.5],
    ["the first extrapolated cell", 15],
    ["the second extrapolated cell", 16],
    ["off the 0.5 grid entirely", 6.75],
    ["not a number", Number.NaN],
  ])("refuses to extrapolate: %s", (_label, k) => {
    // The published first differences are not monotone -- there is a genuine -3.2 kink between
    // nRM(10) and nRM(11), forced by two independently printed cells -- so any model fitted to the
    // low-rep end is wrong at the high-rep end. `null` here is what makes `e1rm` fall back to
    // Brzycki instead of inventing an optimistic number.
    expect(nRM(k)).toBeNull();
  });
});

describe("roundHalfUp on the three chart means", () => {
  it.each([
    [93.85, 93.9],
    [79.85, 79.9],
    [69.35, 69.4],
  ])("rounds %d half-up to %d", (input, expected) => {
    // Half-to-even (Python's `round`) gives 93.8 / 79.8 / 69.3 and fails to reproduce three
    // published cells. If this table ever becomes a generated fixture, the generator must use
    // Decimal(...).quantize(ROUND_HALF_UP).
    expect(roundHalfUp(input, 1)).toBe(expected);
  });
});

describe("pct1RM", () => {
  it.each(PCT1RM_GRID)("reps %d @ RPE %d is %d%% of 1RM", (reps, rpe, expected) => {
    expect(pct1RM(reps, rpe)).toBeCloseTo(expected, 6);
  });

  it("interpolates linearly in RPE between grid columns", () => {
    // eff = 5 + (10 - 8.25) = 6.75, bracketed by nRM(6.5) = 82.4 and nRM(7) = 81.1.
    expect(pct1RM(5, 8.25)).toBe(81.75);
  });

  it.each(PCT1RM_OFF_TABLE)("returns null: %s", (_label, reps, rpe) => {
    expect(pct1RM(reps, rpe)).toBeNull();
  });

  it("rejects malformed reps", () => {
    expect(pct1RM(0, 8)).toBeNull();
    expect(pct1RM(2.5, 8)).toBeNull();
  });

  it("rejects a non-finite RPE", () => {
    expect(pct1RM(5, Number.NaN)).toBeNull();
  });

  it("is the diagonal of one curve: reps + RIR is what the chart reads", () => {
    // The whole 80-cell grid collapses to a 14-element column because a set of `reps` at `rpe` has
    // the same %1RM as a set of `reps + RIR` taken to failure.
    expect(pct1RM(5, 8)).toBe(pct1RM(7, 10));
    expect(pct1RM(8, 9)).toBe(pct1RM(9, 10));
  });
});

describe("rirFromRpe / rpeFromRir", () => {
  it.each([6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10])("round-trips RPE %d", (rpe) => {
    const rir = rirFromRpe(rpe);
    expect(rir).not.toBeNull();
    expect(rpeFromRir(rir as number)).toBe(rpe);
  });

  it("is 10 - x, verified from Zourdos 2016", () => {
    expect(rirFromRpe(10)).toBe(0);
    expect(rirFromRpe(8)).toBe(2);
    expect(rpeFromRir(0)).toBe(10);
  });

  it.each([
    ["negative RPE", -1],
    ["above failure", 11],
    ["not a number", Number.NaN],
  ])("rejects %s", (_label, value) => {
    expect(rirFromRpe(value)).toBeNull();
    expect(rpeFromRir(value)).toBeNull();
  });
});
