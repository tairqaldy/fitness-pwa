/**
 * The r09 test vectors, transcribed as typed tables.
 *
 * **Every expected number in `tests/calc/**` comes from here, and every number here comes from
 * `docs/research/r09-formulas-and-test-vectors.md`.** Nothing in this file was derived by the code
 * under test, and nothing was recomputed to make a test pass -- that is the whole point of having an
 * oracle. Where r09 and `specs/07-calculators.md` disagree on a number, r09 wins and the
 * disagreement is noted at the vector.
 *
 * Section references below are to r09.
 */

import type { CalcSet, DatedSet, MuscleCredit, PlateInventory } from "@/lib/calc";

// -----------------------------------------------------------------------------------------------
// Section 1 -- Epley and Brzycki
// -----------------------------------------------------------------------------------------------

/** `[label, weightKg, reps, epley, brzycki]`. `brzycki === null` marks the pole at 37 reps. */
export const E1RM_VECTORS = [
  ["V1 one rep -- Epley is NOT w", 100, 1, 103.333333, 100.0],
  ["V2", 100, 5, 116.666667, 112.5],
  ["r=6 (the 36-vs-37 trap value)", 100, 6, 120.0, 116.129032],
  ["V3 the crossover", 100, 10, 133.333333, 133.333333],
  ["V4", 100, 12, 140.0, 144.0],
  ["a real bench single", 82.5, 8, 104.5, 102.413793],
  ["absurd but finite", 100, 36, 220.0, 3600.0],
  ["V6 the pole", 100, 37, 223.333333, null],
  ["beyond the pole -- Brzycki goes negative", 100, 38, 226.666667, null],
] as const satisfies ReadonlyArray<readonly [string, number, number, number, number | null]>;

// -----------------------------------------------------------------------------------------------
// Section 2 -- the RPE chart and the composite
// -----------------------------------------------------------------------------------------------

/** The attested `nRM` column, `k = 1..14`. `k = 14` is back-solved from a printed cell. */
export const NRM_CELLS = [
  [1, 100.0],
  [2, 95.5],
  [3, 92.2],
  [4, 89.2],
  [5, 86.3],
  [6, 83.7],
  [7, 81.1],
  [8, 78.6],
  [9, 76.2],
  [10, 73.9],
  [11, 70.7],
  [12, 68.0],
  [13, 65.3],
  [14, 62.7],
] as const satisfies ReadonlyArray<readonly [number, number]>;

/**
 * The published grid, `[reps, rpe, pct1RM]`. Cells r09 marks with `*` are `UNVERIFIED` because they
 * depend on an extrapolated `nRM(15)`/`nRM(16)` that no source attests; they appear in
 * `PCT1RM_OFF_TABLE` instead, where the expectation is `null`.
 */
export const PCT1RM_GRID = [
  [1, 10, 100.0],
  [1, 9.5, 97.8],
  [1, 9, 95.5],
  [1, 8.5, 93.9],
  [1, 8, 92.2],
  [1, 7.5, 90.7],
  [1, 7, 89.2],
  [1, 6.5, 87.8],
  [1, 6, 86.3],
  [2, 10, 95.5],
  [2, 8, 89.2],
  [2, 6, 83.7],
  [3, 10, 92.2],
  [3, 8.5, 87.8],
  [3, 6, 81.1],
  [4, 10, 89.2],
  [4, 7, 81.1],
  [5, 10, 86.3],
  [5, 9, 83.7],
  [5, 8, 81.1],
  [5, 7, 78.6],
  [5, 6, 76.2],
  [6, 10, 83.7],
  [6, 8.5, 79.9],
  [6, 6, 73.9],
  [7, 10, 81.1],
  [7, 7, 73.9],
  [7, 6, 70.7],
  [8, 10, 78.6],
  [8, 8, 73.9],
  [8, 7, 70.7],
  [8, 6, 68.0],
  [9, 10, 76.2],
  [9, 8, 70.7],
  [9, 6.5, 66.7],
  [9, 6, 65.3],
  [10, 10, 73.9],
  [10, 9, 70.7],
  [10, 7, 65.3],
  [10, 6.5, 64.0],
  [10, 6, 62.7],
  [11, 10, 70.7],
  [11, 8, 65.3],
  [11, 7, 62.7],
  [12, 10, 68.0],
  [12, 8, 62.7],
] as const satisfies ReadonlyArray<readonly [number, number, number]>;

/** Cells that must be `null`: off the attested table, or below the RPE floor. */
export const PCT1RM_OFF_TABLE = [
  ["reps 11 @ RPE 6.5 needs the unattested nRM(15)", 11, 6.5],
  ["reps 11 @ RPE 6 needs the unattested nRM(16)", 11, 6],
  ["reps 12 @ RPE 7.5 needs nRM(15)", 12, 7.5],
  ["reps 12 @ RPE 6 needs nRM(16)", 12, 6],
  ["RPE below the floor", 5, 5.5],
  ["RPE 0 is not on the scale", 5, 0],
  ["RPE above failure", 5, 10.5],
] as const satisfies ReadonlyArray<readonly [string, number, number]>;

/**
 * The composite vectors. `expectedKg`/`expectedSource` are the **capped** result, so R6 is 158.4
 * rather than r09's uncapped 159.4896 -- the cap is spec 07 rule 11, taking r09 section 2's own
 * recommended open-decision (a).
 */
export const COMPOSITE_VECTORS = [
  ["R1 Epley wins at true failure", 100, 5, 10, 116.666667, "epley"],
  ["R2 RPE wins -- the headline vector", 100, 5, 8, 123.304562, "rpe"],
  ["R3 RPE wins even at failure", 100, 8, 10, 127.226463, "rpe"],
  ["R4", 100, 10, 9, 141.442716, "rpe"],
  ["R5 interpolated RPE", 100, 5, 8.25, 122.324159, "rpe"],
  ["R6 the inflation cap fires", 100, 12, 8, 158.4, "rpe"],
  ["off-table RPE falls back to Brzycki", 100, 12, 6, 144.0, "brzycki"],
  ["sub-6 RPE falls back to Epley", 100, 5, 5.5, 116.666667, "epley"],
  ["a single at RPE 9 does exceed w", 100, 1, 9, 104.712042, "rpe"],
] as const satisfies ReadonlyArray<readonly [string, number, number, number, number, string]>;

/** R6 uncapped, for the assertion that the cap actually bit. */
export const R6_UNCAPPED_KG = 159.489633;

// -----------------------------------------------------------------------------------------------
// Section 3 -- US Navy body fat
// -----------------------------------------------------------------------------------------------

export const NAVY_MALE_VECTORS = [
  ["M1", 85.0, 38.0, 178.0, 16.436],
  ["M2", 100.0, 40.0, 178.0, 25.5011],
] as const satisfies ReadonlyArray<readonly [string, number, number, number, number]>;

export const NAVY_FEMALE_VECTORS = [
  ["F1", 72.0, 96.0, 32.0, 165.0, 26.4059],
  ["F2", 88.0, 105.0, 34.0, 165.0, 37.5517],
] as const satisfies ReadonlyArray<readonly [string, number, number, number, number, number]>;

/** M1's centimetres pushed through the **inch** equation. The catastrophe a test must exclude. */
export const NAVY_M1_THROUGH_INCH_EQUATION = 22.9555;

/** M1's body fat applied to an 82 kg bodyweight (used by Katch-McArdle too). */
export const M1_BODY = { weightKg: 82.0, bodyFatPct: 16.436, leanMassKg: 68.52248 } as const;

// -----------------------------------------------------------------------------------------------
// Section 4 -- trend weight
// -----------------------------------------------------------------------------------------------

/** Ten consecutive daily weigh-ins, kg. */
export const TREND_SERIES_KG = [82.0, 82.6, 81.8, 82.4, 83.1, 82.2, 81.9, 82.5, 82.0, 81.6];

/** The expected trend after each reading, to 6 dp. `T[0]` is the seed and equals `W[0]` exactly. */
export const TREND_EXPECTED_KG = [
  82.0, 82.06, 82.034, 82.0706, 82.17354, 82.176186, 82.148567, 82.183711, 82.16534, 82.108806,
];

/** Arithmetic mean of `TREND_SERIES_KG`; the EMA lags it on a falling series, which is the point. */
export const TREND_SERIES_MEAN_KG = 82.21;
export const TREND_LAG_VS_MEAN_KG = -0.101194;

/** Day 11 missing, day 12 reads 81.4. Gap-aware alpha is `1 - 0.9^2 = 0.19`. */
export const TREND_AFTER_ONE_MISSED_DAY_KG = 81.974133;
/** What the rejected skip-missing policy would have produced. A test asserts we are NOT this. */
export const TREND_SKIP_MISSING_KG = 82.037925;

export const TREND_DATES = [
  "2026-09-07",
  "2026-09-08",
  "2026-09-09",
  "2026-09-10",
  "2026-09-11",
  "2026-09-12",
  "2026-09-13",
  "2026-09-14",
  "2026-09-15",
  "2026-09-16",
];

// -----------------------------------------------------------------------------------------------
// Section 5 -- energy and adaptive TDEE
// -----------------------------------------------------------------------------------------------

export const MSJ_MALE_82_178_30 = 1787.5;
export const MSJ_FEMALE_65_165_30 = 1370.25;
export const MSJ_COMBINED_MALE_82_178_30 = 1789.08;
export const MSJ_SPLIT_VS_COMBINED_DELTA = 1.58;
export const KATCH_M1_BODY = 1850.085568;
export const PRIOR_MSJ_X155 = 2770.625;
export const PRIOR_KATCH_X155 = 2867.63263;

/** The week-4 back-calculation, and the value the sign bug would produce instead. */
export const TDEE_WEEK4 = {
  meanIntakeKcal: 2450,
  trendStartKg: 82.4,
  trendEndKg: 81.5,
  days: 28,
  expectedKcal: 2697.5,
  signBugKcal: 2202.5,
} as const;

/** `[label, meanIntake, trendEnd, completeDays, tdeeData, blended, blendWeight, status]`. */
export const TDEE_WEEKS = [
  ["week 1", 2500, 82.3, 7, 2610.0, 2730.4688, 0.25, "CALIBRATING"],
  ["week 2", 2480, 82.05, 14, 2672.5, 2721.5625, 0.5, "CALIBRATING"],
  ["week 3", 2460, 81.8, 21, 2680.0, 2702.6563, 0.75, "OK"],
  ["week 4", 2450, 81.5, 28, 2697.5, 2697.5, 1, "OK"],
] as const satisfies ReadonlyArray<
  readonly [string, number, number, number, number, number, number, string]
>;

export const TDEE_TREND_START_KG = 82.4;

// -----------------------------------------------------------------------------------------------
// Sections 6 and 7 -- plates and warm-ups
// -----------------------------------------------------------------------------------------------

export const BAR_KG = 20.0;

/** `[plateKg, pairsAvailable]`. `minIncrement = 2 * 0.5 = 1.0 kg`. */
export const GYM_INVENTORY: PlateInventory = [
  [25, 2],
  [20, 2],
  [15, 1],
  [10, 2],
  [5, 2],
  [2.5, 2],
  [1.25, 2],
  [0.5, 2],
];

export const MIN_INCREMENT_KG = 1.0;

/** `[label, targetKg, platesPerSide, achievedKg, errorKg, status]`, nearest mode. */
export const PLATE_VECTORS_NEAREST = [
  ["P1", 100.0, [25, 15], 100.0, 0.0, "EXACT"],
  ["P2 the microplate vector", 62.5, [20, 1.25], 62.5, 0.0, "EXACT"],
  ["P3 nearest beats greedy 9x", 101.9, [25, 15, 0.5, 0.5], 102.0, 0.1, "ROUNDED"],
  ["P4 below the bar", 15.0, [], 20.0, 5.0, "BELOW_BAR"],
  ["upward tie-break", 102.25, [25, 15, 1.25], 102.5, 0.25, "ROUNDED"],
  ["fewest plates, heavier outside", 102.0, [25, 15, 0.5, 0.5], 102.0, 0.0, "EXACT"],
  ["the bar itself", 20.0, [], 20.0, 0.0, "EXACT"],
] as const satisfies ReadonlyArray<
  readonly [string, number, readonly number[], number, number, string]
>;

/** P3 again, in round-down mode: this is what greedy would also have produced. */
export const P3_ROUND_DOWN = {
  targetKg: 101.9,
  platesPerSide: [25, 15, 0.5],
  achievedKg: 101.0,
  errorKg: -0.9,
} as const;

/**
 * Every achievable total in `[99, 105]` on a 20 kg bar with `GYM_INVENTORY`.
 *
 * 100.5 and 101.5 are **absent**, and that absence is the whole "why can't I load 101.5?" question:
 * the lightest plate is 0.5 kg, so the lattice steps 1.0 kg.
 */
export const LATTICE_99_TO_105 = [99.5, 100.0, 101.0, 102.0, 102.5, 103.5, 104.5, 105.0];

/** `[pct, reps, rawKg, weightKg, platesPerSide]` for a 100 kg top working set. */
export const WARMUP_W1 = [
  [0.4, 5, 40.0, 40.0, [10]],
  [0.5, 5, 50.0, 50.0, [15]],
  [0.6, 3, 60.0, 60.0, [20]],
] as const satisfies ReadonlyArray<readonly [number, number, number, number, readonly number[]]>;

/** 87.5 kg: the middle step's 43.75 kg is not loadable, so it rounds down to 43.5. */
export const WARMUP_W2 = [
  [0.4, 5, 35.0, 35.0, [5, 2.5]],
  [0.5, 5, 43.75, 43.5, [10, 1.25, 0.5]],
  [0.6, 3, 52.5, 52.5, [15, 1.25]],
] as const satisfies ReadonlyArray<readonly [number, number, number, number, readonly number[]]>;

/** What a Wendler-literal "fix" (dividing by 0.9) would make step 1 of a 100 kg working set. */
export const WARMUP_TRAINING_MAX_BUG_KG = 44.4;

// -----------------------------------------------------------------------------------------------
// Section 8 -- volume
// -----------------------------------------------------------------------------------------------

const BENCH = "barbell-bench-press";
const INCLINE = "incline-db-press";
const FLY = "cable-fly";
const PUSHDOWN = "triceps-pushdown";

function set(
  exerciseId: string,
  localDate: string,
  type: CalcSet["type"],
  weightKg: number,
  reps: number,
  rir: number | null = null,
): DatedSet {
  return {
    exerciseId,
    localDate,
    type,
    weightKg,
    reps,
    rpe: rir === null ? null : 10 - rir,
    rir,
  };
}

/**
 * r09's worked week: 10 sets across three sessions.
 *
 * The first session is dated `2026-09-07`, and r09 makes the point that one of those sets was logged
 * at 00:30 local -- `2026-09-06T19:30:00Z`. Grouping by UTC date would drop it and with it 640 kg of
 * chest volume, which is why `localDate` is stored and never re-derived.
 */
export const VOLUME_WEEK: readonly DatedSet[] = [
  set(BENCH, "2026-09-07", "warmup", 40.0, 5),
  set(BENCH, "2026-09-07", "warmup", 60.0, 3),
  set(BENCH, "2026-09-07", "working", 80.0, 8),
  set(BENCH, "2026-09-07", "working", 80.0, 7),
  set(BENCH, "2026-09-07", "drop", 60.0, 10),
  set(INCLINE, "2026-09-09", "working", 30.0, 10),
  set(INCLINE, "2026-09-09", "working", 30.0, 9),
  set(FLY, "2026-09-11", "working", 20.0, 12),
  set(FLY, "2026-09-11", "working", 20.0, 12, 5),
  set(PUSHDOWN, "2026-09-11", "working", 35.0, 12),
];

/** Muscle credit as spec 08 would supply it: primary 1.0, secondary 0.5. */
export const VOLUME_CREDITS: ReadonlyMap<string, readonly MuscleCredit[]> = new Map([
  [
    BENCH,
    [
      { muscle: "chest", credit: 1.0 },
      { muscle: "front_delts", credit: 0.5 },
      { muscle: "triceps", credit: 0.5 },
    ],
  ],
  [
    INCLINE,
    [
      { muscle: "chest", credit: 1.0 },
      { muscle: "front_delts", credit: 0.5 },
      { muscle: "triceps", credit: 0.5 },
    ],
  ],
  [FLY, [{ muscle: "chest", credit: 1.0 }]],
  [PUSHDOWN, [{ muscle: "triceps", credit: 1.0 }]],
]);

export const VOLUME_TOTAL_KG = 3270.0;
/** The 380 kg of warm-ups that `totalVolumeKg` must exclude. */
export const VOLUME_WARMUP_KG = 380.0;

export const HARD_SETS_BY_MUSCLE = { chest: 6.0, front_delts: 2.5, triceps: 3.5 } as const;
export const VOLUME_BY_MUSCLE = { chest: 2850.0, front_delts: 1185.0, triceps: 1605.0 } as const;
/** The deliberate double-count: 5640 across muscles against 3270 kg of real tonnage. */
export const VOLUME_BY_MUSCLE_SUM_KG = 5640.0;

export const VOLUME_EXERCISE_IDS = { BENCH, INCLINE, FLY, PUSHDOWN } as const;

// -----------------------------------------------------------------------------------------------
// Section 8 -- the Almaty calendar
// -----------------------------------------------------------------------------------------------

/** `2026-09-13T07:30:00+05:00`. */
export const NOW_MS = 1789266600000;

export const ROLLING_7D_WINDOW = {
  startDate: "2026-09-07",
  endDate: "2026-09-13",
  startMs: 1788721200000,
  endMs: 1789325999999,
} as const;

/** The off-by-one: `19:30Z` on the 6th is `00:30` local on the 7th. */
export const OFF_BY_ONE = {
  insideMs: Date.parse("2026-09-06T19:30:00Z"),
  insideLocalDate: "2026-09-07",
  outsideMs: Date.parse("2026-09-06T18:59:59Z"),
  outsideLocalDate: "2026-09-06",
} as const;
