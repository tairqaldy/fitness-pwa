import { describe, expect, it } from "vitest";

import {
  HARD_SET_MAX_RIR,
  hardSetsByMuscle,
  isCountedSet,
  isHardSet,
  localDateFromInstant,
  PRIMARY_MUSCLE_CREDIT,
  rolling7dVolumeKg,
  SECONDARY_MUSCLE_CREDIT,
  setsInRolling7d,
  setVolumeKg,
  totalVolumeKg,
  volumeByMuscle,
  type CalcSet,
  type CreditsByExercise,
  type DatedSet,
} from "@/lib/calc";

import {
  HARD_SETS_BY_MUSCLE,
  NOW_MS,
  OFF_BY_ONE,
  VOLUME_BY_MUSCLE,
  VOLUME_BY_MUSCLE_SUM_KG,
  VOLUME_CREDITS,
  VOLUME_EXERCISE_IDS,
  VOLUME_TOTAL_KG,
  VOLUME_WARMUP_KG,
  VOLUME_WEEK,
} from "./fixtures/r09-vectors";

/** The r09 week's per-muscle tonnage, asserted non-null once so each test can read it directly. */
function volumeMap(): Map<string, number> {
  const actual = volumeByMuscle(VOLUME_WEEK, VOLUME_CREDITS);
  expect(actual).not.toBeNull();
  return actual as Map<string, number>;
}

/** A minimal set, so each test can vary exactly the field it is about. */
function aSet(over: Partial<CalcSet> = {}): CalcSet {
  return {
    exerciseId: VOLUME_EXERCISE_IDS.BENCH,
    type: "working",
    weightKg: 80,
    reps: 8,
    rpe: null,
    rir: null,
    ...over,
  };
}

describe("isCountedSet", () => {
  it.each([
    ["working", "working", true],
    ["drop", "drop", true],
    ["failure", "failure", true],
    ["warmup", "warmup", false],
  ])("%s sets count: %s", (_label, type, expected) => {
    expect(isCountedSet(aSet({ type: type as CalcSet["type"] }))).toBe(expected);
  });
});

describe("isHardSet", () => {
  it("counts a set logged without RPE or RIR", () => {
    // The user did the work. Excluding unannotated sets makes the heatmap and the volume chart
    // silently disagree about the same session, which is worse than either policy being slightly off.
    expect(isHardSet(aSet({ rir: null }))).toBe(true);
  });

  it.each([
    ["RIR 0", 0, true],
    ["RIR 4 -- exactly at the threshold", 4, true],
    ["RIR 4.5", 4.5, false],
    ["RIR 5", 5, false],
    ["a NaN RIR", Number.NaN, false],
  ])("%s", (_label, rir, expected) => {
    expect(isHardSet(aSet({ rir }))).toBe(expected);
  });

  it("never counts a warm-up, whatever its RIR", () => {
    expect(isHardSet(aSet({ type: "warmup", rir: 0 }))).toBe(false);
  });

  it("uses the named threshold", () => {
    expect(HARD_SET_MAX_RIR).toBe(4);
  });
});

describe("setVolumeKg", () => {
  it("is reps x weight", () => {
    expect(setVolumeKg(aSet({ weightKg: 80, reps: 8 }))).toBe(640);
  });

  it("is 0, not null, for a bodyweight set", () => {
    // Tonnage is a load metric, and 0 is the honest load for a bodyweight pull-up.
    expect(setVolumeKg(aSet({ weightKg: 0, reps: 10 }))).toBe(0);
  });

  it.each([
    ["fractional reps", { reps: 2.5 }],
    ["zero reps", { reps: 0 }],
    ["a negative weight", { weightKg: -80 }],
    ["a NaN weight", { weightKg: Number.NaN }],
  ])("is null for %s", (_label, over) => {
    expect(setVolumeKg(aSet(over))).toBeNull();
  });
});

describe("totalVolumeKg", () => {
  it("excludes warm-ups: the r09 week is 3270 kg, not 3650", () => {
    expect(totalVolumeKg(VOLUME_WEEK)).toBe(VOLUME_TOTAL_KG);
    const everything = VOLUME_WEEK.reduce((s, set) => s + set.reps * set.weightKg, 0);
    expect(everything - VOLUME_TOTAL_KG).toBe(VOLUME_WARMUP_KG);
  });

  it("includes drop sets, which are working stimulus by any definition", () => {
    const withoutDrop = VOLUME_WEEK.filter((s) => s.type !== "drop");
    expect((totalVolumeKg(VOLUME_WEEK) ?? 0) - (totalVolumeKg(withoutDrop) ?? 0)).toBe(600);
  });

  it("is 0 for no sets", () => {
    expect(totalVolumeKg([])).toBe(0);
  });

  it("is null rather than a silently short total when a counted set is malformed", () => {
    expect(totalVolumeKg([aSet(), aSet({ reps: 0 })])).toBeNull();
  });

  it("ignores a malformed warm-up, because warm-ups never contribute anyway", () => {
    expect(totalVolumeKg([aSet(), aSet({ type: "warmup", reps: 0 })])).toBe(640);
  });
});

describe("hardSetsByMuscle", () => {
  it("credits the r09 week as 6.0 / 2.5 / 3.5", () => {
    const actual = hardSetsByMuscle(VOLUME_WEEK, VOLUME_CREDITS);
    expect(actual?.get("chest")).toBe(HARD_SETS_BY_MUSCLE.chest);
    expect(actual?.get("front_delts")).toBe(HARD_SETS_BY_MUSCLE.front_delts);
    expect(actual?.get("triceps")).toBe(HARD_SETS_BY_MUSCLE.triceps);
  });

  it("excludes the RIR-5 fly from hard sets while keeping its tonnage", () => {
    // Chest would be 7.0 hard sets if the RIR-5 set counted; its 240 kg still shows up in volume.
    const hard = hardSetsByMuscle(VOLUME_WEEK, VOLUME_CREDITS);
    expect(hard?.get("chest")).toBe(6.0);
    expect(totalVolumeKg(VOLUME_WEEK)).toBe(VOLUME_TOTAL_KG);
  });
});

describe("volumeByMuscle", () => {
  it("credits the r09 week as 2850 / 1185 / 1605 kg", () => {
    const actual = volumeMap();
    expect(actual.get("chest")).toBe(VOLUME_BY_MUSCLE.chest);
    expect(actual.get("front_delts")).toBe(VOLUME_BY_MUSCLE.front_delts);
    expect(actual.get("triceps")).toBe(VOLUME_BY_MUSCLE.triceps);
  });

  it("double-counts by design, so this map is never session volume", () => {
    // 5640 kg across muscles against 3270 kg of real tonnage -- 72% high. If a dashboard tile ever
    // sums the heatmap's rows, that is the number it will print.
    const sum = [...volumeMap().values()].reduce((s, v) => s + v, 0);
    expect(sum).toBe(VOLUME_BY_MUSCLE_SUM_KG);
    expect(sum).not.toBe(VOLUME_TOTAL_KG);
  });

  it("leaves an unmapped exercise out of the map but inside the tonnage", () => {
    // free-exercise-db ships secondaryMuscles: [] routinely, so an unmapped exercise is a normal
    // state of the library, not an error.
    const sets = [
      ...VOLUME_WEEK,
      { ...aSet({ exerciseId: "mystery-machine" }), localDate: "2026-09-11" },
    ];
    const byMuscle = volumeByMuscle(sets, VOLUME_CREDITS);
    expect([...(byMuscle as Map<string, number>).keys()].sort()).toEqual([
      "chest",
      "front_delts",
      "triceps",
    ]);
    expect(totalVolumeKg(sets)).toBe(VOLUME_TOTAL_KG + 640);
  });

  it("is an empty Map for no sets, not null", () => {
    expect(volumeByMuscle([], VOLUME_CREDITS)).toEqual(new Map());
    expect(hardSetsByMuscle([], VOLUME_CREDITS)).toEqual(new Map());
  });

  it("is null when a credit is out of its (0, 1] domain", () => {
    for (const credit of [0, -0.5, 1.5, Number.NaN]) {
      const credits: CreditsByExercise = new Map([
        [VOLUME_EXERCISE_IDS.BENCH, [{ muscle: "chest", credit }]],
      ]);
      expect(volumeByMuscle([aSet()], credits)).toBeNull();
    }
  });

  it("is null for an empty muscle name", () => {
    const credits: CreditsByExercise = new Map([
      [VOLUME_EXERCISE_IDS.BENCH, [{ muscle: "", credit: 1 }]],
    ]);
    expect(volumeByMuscle([aSet()], credits)).toBeNull();
  });

  it("is null when a counted set is malformed", () => {
    expect(volumeByMuscle([aSet({ reps: 0 })], VOLUME_CREDITS)).toBeNull();
  });

  it("is null when the credits are not a Map", () => {
    expect(volumeByMuscle([aSet()], null as unknown as CreditsByExercise)).toBeNull();
  });
});

describe("the muscle-credit conventions are named, not sprinkled", () => {
  it("pins 1.0 primary and 0.5 secondary", () => {
    // The 0.5 is the opposite of Schoenfeld 2019's "1:1 basis" recommendation. It is a heatmap
    // display convention and the legend must say "secondary muscles counted at 50%".
    expect(PRIMARY_MUSCLE_CREDIT).toBe(1.0);
    expect(SECONDARY_MUSCLE_CREDIT).toBe(0.5);
  });
});

describe("the rolling 7-day Almaty window", () => {
  it("contains the whole r09 week", () => {
    expect(setsInRolling7d(NOW_MS, VOLUME_WEEK)).toHaveLength(VOLUME_WEEK.length);
    expect(rolling7dVolumeKg(NOW_MS, VOLUME_WEEK)).toBe(VOLUME_TOTAL_KG);
  });

  it("keeps a 00:30-local session, which grouping by UTC date would drop", () => {
    // This is the 640 kg set. Keyed on its Almaty date it is inside the window; keyed on its UTC
    // date (2026-09-06) it falls outside, and the week silently loses a fifth of its chest volume.
    const almatySet: DatedSet = {
      ...aSet({ weightKg: 80, reps: 8 }),
      localDate: localDateFromInstant(OFF_BY_ONE.insideMs) as string,
    };
    const utcSet: DatedSet = { ...almatySet, localDate: OFF_BY_ONE.outsideLocalDate };

    expect(almatySet.localDate).toBe("2026-09-07");
    expect(rolling7dVolumeKg(NOW_MS, [almatySet])).toBe(640);
    expect(rolling7dVolumeKg(NOW_MS, [utcSet])).toBe(0);
  });

  it("excludes a session one day before the window opens", () => {
    const stale: DatedSet = { ...aSet(), localDate: "2026-09-06" };
    expect(setsInRolling7d(NOW_MS, [stale])).toEqual([]);
  });

  it("includes today, the seventh day", () => {
    const today: DatedSet = { ...aSet(), localDate: "2026-09-13" };
    expect(setsInRolling7d(NOW_MS, [today])).toHaveLength(1);
  });

  it("is null when the anchor instant is not usable", () => {
    expect(setsInRolling7d(Number.NaN, VOLUME_WEEK)).toBeNull();
    expect(rolling7dVolumeKg(Number.NaN, VOLUME_WEEK)).toBeNull();
  });
});
