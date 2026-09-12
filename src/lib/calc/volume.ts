/**
 * Volume, hard sets, muscle credit, and the rolling 7-day window they are read over.
 *
 *     setVolumeKg      = reps * weightKg
 *     totalVolumeKg    = sum of setVolumeKg over sets of type working | drop | failure
 *     isHardSet(s)     = isCountedSet(s) && (s.rir === null || s.rir <= 4)
 *
 * The arithmetic needs no citation; the **policies** do, and each is stated here so it is testable.
 *
 * **Warm-ups are excluded, drop sets are included.** Drop sets are taken to or near failure and are
 * working stimulus by any definition. A warm-up is not. Note the side effect: one bench triple plus
 * a drop is four credited hard sets for chest from what the user experienced as one hard effort.
 *
 * **A bodyweight set is `0 kg`, not `null`.** Tonnage is a load metric, and `0` is the honest load.
 *
 * **A counted set logged without RPE/RIR counts as hard.** The user did the work. The alternative --
 * `rir <= 4` failing on `null` -- makes the heatmap and the volume chart silently disagree about the
 * same session, which is worse than either policy being slightly wrong.
 *
 * **Secondary credit is 0.5, and it is a convention that contradicts the evidence.** The only paper
 * written on the question concludes that the best advice is "to view set-volume prescription on a
 * 1:1 basis" (Schoenfeld, Grgic, Haun, Itagaki, Helms, *Sports* 7(7):177, 2019). We use 0.5 anyway
 * because a heatmap's job is relative visual emphasis -- 1:1 makes every pressing week look like
 * maximal arm volume -- but the constant is named, the legend must say "secondary muscles counted at
 * 50%", and the weights arrive as data from spec 08 rather than hard-coded here.
 *
 * **The per-muscle maps double-count, by design.** On r09's worked week they sum to 5640 kg against
 * 3270 kg of real tonnage -- 72% high. `totalVolumeKg` is the *only* source of session volume. No
 * dashboard tile may sum the heatmap's rows and call the result volume.
 *
 * **Everything calendar-shaped goes through the Almaty local date.** A set logged at 00:30 local is
 * `19:30Z the previous day`; grouping by UTC date drops it from the window, and in r09's worked week
 * that one set is 640 kg of chest volume. See `time.ts`.
 */

import { COUNTED_SET_TYPES, HARD_SET_MAX_RIR } from "./constants";
import { isFiniteNum, isNonNeg, isPosInt } from "./num";
import { rolling7dWindow } from "./time";
import type { CalcSet, DatedSet, MuscleCredit } from "./types";

/** Per-exercise muscle credits, supplied by spec 08's `exercise_muscles` table. */
export type CreditsByExercise = ReadonlyMap<string, readonly MuscleCredit[]>;

/** Does this set contribute tonnage and hard-set credit at all? */
export function isCountedSet(s: CalcSet): boolean {
  return COUNTED_SET_TYPES.includes(s.type);
}

/**
 * Is this a hard set?
 *
 * `rir === null` counts. See the module note: the user did the work, and excluding unannotated sets
 * desynchronises the heatmap from the volume chart.
 */
export function isHardSet(s: CalcSet): boolean {
  if (!isCountedSet(s)) return false;
  if (s.rir === null) return true;
  return isFiniteNum(s.rir) && s.rir <= HARD_SET_MAX_RIR;
}

/** `reps * weightKg`. `0` for a bodyweight set; `null` only for input that is not a set. */
export function setVolumeKg(s: CalcSet): number | null {
  if (!isPosInt(s.reps) || !isNonNeg(s.weightKg)) return null;
  return s.reps * s.weightKg;
}

/**
 * Session or window tonnage over counted sets only.
 *
 * `null` if any counted set is malformed -- a partial total is worse than no total, because it looks
 * like a real number and silently under-reports.
 */
export function totalVolumeKg(sets: readonly CalcSet[]): number | null {
  let total = 0;
  for (const s of sets) {
    if (!isCountedSet(s)) continue;
    const volume = setVolumeKg(s);
    if (volume === null) return null;
    total += volume;
  }
  return total;
}

/** Validate a credit list. `credit` is a fraction in `(0, 1]`; a muscle name must be non-empty. */
function creditsAreValid(credits: readonly MuscleCredit[]): boolean {
  for (const c of credits) {
    if (typeof c.muscle !== "string" || c.muscle.length === 0) return false;
    if (!isFiniteNum(c.credit) || c.credit <= 0 || c.credit > 1) return false;
  }
  return true;
}

/**
 * Fold sets into a per-muscle map, weighting each set by its exercise's muscle credits.
 *
 * A set whose `exerciseId` is absent from `credits` contributes to no muscle and is **not** an
 * error: free-exercise-db frequently ships `secondaryMuscles: []`, and an unmapped exercise is a
 * normal state of the library, not a failure. It still counts in `totalVolumeKg`.
 */
function foldByMuscle(
  sets: readonly CalcSet[],
  credits: CreditsByExercise,
  include: (s: CalcSet) => boolean,
  valueOf: (s: CalcSet) => number | null,
): Map<string, number> | null {
  if (!(credits instanceof Map)) return null;
  const out = new Map<string, number>();
  for (const s of sets) {
    if (!include(s)) continue;
    const value = valueOf(s);
    if (value === null) return null;
    const forExercise = credits.get(s.exerciseId);
    if (forExercise === undefined) continue;
    if (!creditsAreValid(forExercise)) return null;
    for (const c of forExercise) {
      out.set(c.muscle, (out.get(c.muscle) ?? 0) + value * c.credit);
    }
  }
  return out;
}

/** Per-muscle tonnage in kg. Double-counts across muscles by design -- never sum this map. */
export function volumeByMuscle(
  sets: readonly CalcSet[],
  credits: CreditsByExercise,
): Map<string, number> | null {
  return foldByMuscle(sets, credits, isCountedSet, setVolumeKg);
}

/** Per-muscle hard-set count, fractional because secondary muscles are credited at 0.5. */
export function hardSetsByMuscle(
  sets: readonly CalcSet[],
  credits: CreditsByExercise,
): Map<string, number> | null {
  return foldByMuscle(sets, credits, isHardSet, () => 1);
}

/**
 * The sets falling inside the rolling 7-day Almaty window ending on `nowMs`'s local day.
 *
 * Filters on the **stored** `localDate`, by string comparison against the window bounds. That is
 * the whole point: the local date was computed once at write time from the true instant, so this
 * comparison cannot drift with the runtime's tzdata, and a 00:30-local session stays on the day the
 * user trained rather than sliding to the UTC day before.
 *
 * `nowMs` is the first parameter because nothing in this module reads the clock.
 */
export function setsInRolling7d(nowMs: number, sets: readonly DatedSet[]): DatedSet[] | null {
  const window = rolling7dWindow(nowMs);
  if (window === null) return null;
  return sets.filter((s) => s.localDate >= window.startDate && s.localDate <= window.endDate);
}

/** Tonnage over the rolling 7-day Almaty window. Counted sets only. */
export function rolling7dVolumeKg(nowMs: number, sets: readonly DatedSet[]): number | null {
  const inWindow = setsInRolling7d(nowMs, sets);
  return inWindow === null ? null : totalVolumeKg(inWindow);
}
