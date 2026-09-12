/**
 * Adaptive TDEE: back-calculate expenditure from intake and trend-weight change, blended with a
 * formula prior.
 *
 *     TDEE_data = meanIntake - ((trendEnd - trendStart) * 7700 / days)
 *
 * **The sign is the highest-value assertion in this module.** `+` instead of `-` turns r09's week-4
 * vector from 2697.5 into 2202.5 -- a 495 kcal/day error, in the direction that makes the user lose
 * weight twice as fast as intended, and the wrong number looks entirely plausible. Losing weight
 * means `delta < 0`, so the subtracted term is negative and TDEE comes out *above* intake. That is
 * correct: you burned more than you ate.
 *
 * **Both weights must be trend weights, never raw scale readings.** A single 1.5 kg water swing at
 * a window boundary is `1.5 * 7700 / 28 = 412.5 kcal/day` of pure noise -- larger than any real
 * change in expenditure.
 *
 * **7700 kcal/kg is Wishnofsky's rule, and it is known to be wrong for short windows.** The measured
 * energy content of weight change at week 4 is around 4858 kcal/kg, because early loss is
 * disproportionately glycogen, protein and water. The `completeDays / 28` blend ramp and the 21-day
 * `CALIBRATING` badge exist to absorb that bias. Do not shorten them to make the number appear
 * sooner.
 *
 * **`meanIntakeKcal` and `completeDays` are the caller's contract, and the contract is not
 * optional.** They must be computed over *complete* days only -- days whose logged intake is at
 * least 50% of the window median. Passing 28 when days went unlogged reads every skipped day as a
 * fast, drags mean intake down, makes the algorithm conclude expenditure must be higher, and so
 * *raises* the calorie target -- the exact opposite of what the user needs. MacroFactor calls
 * partial logging "the single cardinal sin"; this is why. `completeDays` is persisted with every
 * estimate so a weird target stays diagnosable months later.
 *
 * `nowMs` is part of the input purely as the window anchor the caller resolved the window with --
 * nothing in here reads a clock.
 */

import {
  ENERGY_DENSITY_KCAL_PER_KG,
  TDEE_MAX_WOW_DELTA,
  TDEE_MIN_INTAKE_DAYS,
  TDEE_MIN_WEIGH_INS,
  TDEE_SUSPECT_DELTA_FRACTION,
  TDEE_WARMUP_DAYS,
  TDEE_WINDOW_DAYS,
} from "./constants";
import { isFiniteNum, isNonNegInt, isPos } from "./num";

export * from "./energy";

/** The back-calculation itself, for inputs whose domain the caller has already established. */
function energyBalanceRaw(
  meanIntakeKcal: number,
  trendStartKg: number,
  trendEndKg: number,
  days: number,
): number {
  const deltaKg = trendEndKg - trendStartKg;
  return meanIntakeKcal - (deltaKg * ENERGY_DENSITY_KCAL_PER_KG) / days;
}

/**
 * Energy-balance back-calculation. kcal/day.
 *
 * `days <= 0` returns `null` rather than dividing. That guard is what stops `completeDays = 0` from
 * producing `Infinity`, which would then be persisted and poison every later week-over-week cap --
 * `clamp(x, Infinity - 250, Infinity + 250)` is not a cap.
 */
export function tdeeFromEnergyBalance(
  meanIntakeKcal: number,
  trendStartKg: number,
  trendEndKg: number,
  days: number,
): number | null {
  if (!isFiniteNum(meanIntakeKcal) || !isPos(trendStartKg) || !isPos(trendEndKg)) return null;
  if (!isPos(days)) return null;
  return energyBalanceRaw(meanIntakeKcal, trendStartKg, trendEndKg, days);
}

export type TdeeStatus =
  | "OK"
  | "CALIBRATING"
  | "INSUFFICIENT_INTAKE_DAYS"
  | "INSUFFICIENT_WEIGH_INS"
  | "SUSPECT_WEIGHT_CHANGE"
  | "NO_PRIOR";

export type TdeeInput = {
  /** Epoch ms UTC -- the window anchor the caller used. The clock is never read inside calc. */
  nowMs: number;
  /** Mifflin-St Jeor or Katch-McArdle, already multiplied by the activity factor. */
  priorKcal: number | null;
  /** Mean over **complete days only** (see the module note). */
  meanIntakeKcal: number | null;
  completeDays: number;
  weighInsInWindow: number;
  /** Real trend points at the window edges, never interpolated across a gap. */
  trendStartKg: number | null;
  trendEndKg: number | null;
  /** The previous week's final estimate, for the week-over-week cap. */
  lastEstimateKcal: number | null;
  /** For the suspect-change badge. `null` means the badge cannot be evaluated at all. */
  bodyWeightKg: number | null;
};

export type TdeeEstimate = {
  tdeeKcal: number | null;
  status: TdeeStatus;
  tdeeDataKcal: number | null;
  priorKcal: number | null;
  blendWeight: number;
  capped: boolean;
  completeDays: number;
  weighInsInWindow: number;
};

/** Fold non-finite garbage in a nullable numeric input into `null`, so `NaN` can never propagate. */
function num(value: number | null): number | null {
  return isFiniteNum(value) ? value : null;
}

/** Coerce a count. Anything that is not a non-negative integer is treated as "none logged". */
function count(value: number): number {
  return isNonNegInt(value) ? value : 0;
}

/**
 * The weekly estimate, with the reason attached.
 *
 * **Never returns `null`** -- the UI must always be able to say *why* a number is missing or greyed,
 * and "no value, no explanation" is the one outcome that makes the screen look broken.
 *
 * Guard ladder, first match wins (spec 07 rule 27):
 *   1. no prior and fewer than 14 complete days -- `NO_PRIOR`, no number at all;
 *   2. fewer than 14 complete days -- `INSUFFICIENT_INTAKE_DAYS`, show the prior;
 *   3. fewer than 10 weigh-ins, or a missing trend edge or mean intake -- `INSUFFICIENT_WEIGH_INS`,
 *      show the prior.
 *
 * Then `w = min(1, completeDays / 28)`, `blended = w * data + (1 - w) * prior`, and the
 * week-over-week clamp at +/- 250 kcal/day. The cap is flat rather than proportional because it
 * absorbs *logging* noise, which is absolute: a missed meal is about 600 kcal regardless of body
 * size.
 *
 * Status after a successful compute: `CALIBRATING` below 21 complete days (7700 kcal/kg
 * overestimates early tissue energy density), else `SUSPECT_WEIGHT_CHANGE` when the window delta
 * exceeds 1% of bodyweight -- a badge, never a block, because the number is still the best estimate
 * available -- else `OK`.
 */
export function adaptiveTdee(input: TdeeInput): TdeeEstimate {
  const priorKcal = num(input.priorKcal);
  const meanIntakeKcal = num(input.meanIntakeKcal);
  const trendStartKg = num(input.trendStartKg);
  const trendEndKg = num(input.trendEndKg);
  const lastEstimateKcal = num(input.lastEstimateKcal);
  const bodyWeightKg = num(input.bodyWeightKg);
  const completeDays = count(input.completeDays);
  const weighInsInWindow = count(input.weighInsInWindow);

  const base = {
    tdeeDataKcal: null,
    priorKcal,
    blendWeight: 0,
    capped: false,
    completeDays,
    weighInsInWindow,
  } as const;

  if (completeDays < TDEE_MIN_INTAKE_DAYS) {
    return priorKcal === null
      ? { ...base, tdeeKcal: null, status: "NO_PRIOR" }
      : { ...base, tdeeKcal: priorKcal, status: "INSUFFICIENT_INTAKE_DAYS" };
  }

  if (
    weighInsInWindow < TDEE_MIN_WEIGH_INS ||
    trendStartKg === null ||
    trendEndKg === null ||
    meanIntakeKcal === null ||
    !isPos(trendStartKg) ||
    !isPos(trendEndKg)
  ) {
    return { ...base, tdeeKcal: priorKcal, status: "INSUFFICIENT_WEIGH_INS" };
  }

  // `completeDays >= 14` here, so the division is safe and the result is finite.
  const tdeeDataKcal = energyBalanceRaw(meanIntakeKcal, trendStartKg, trendEndKg, completeDays);

  // With no prior there is nothing to blend toward, so the data estimate stands alone. The ladder
  // above has already refused the no-prior case below 14 complete days, which is the only point at
  // which the data on its own would be too thin to show.
  const blendWeight = priorKcal === null ? 1 : Math.min(1, completeDays / TDEE_WINDOW_DAYS);
  const blended = blendWeight * tdeeDataKcal + (1 - blendWeight) * (priorKcal ?? 0);

  // The flat week-over-week cap, inlined rather than routed through `clamp`: the bounds here are
  // provably finite and ordered, and a `null` branch that cannot be reached is a branch that can
  // never be tested.
  let tdeeKcal = blended;
  let capped = false;
  if (lastEstimateKcal !== null) {
    const lo = lastEstimateKcal - TDEE_MAX_WOW_DELTA;
    const hi = lastEstimateKcal + TDEE_MAX_WOW_DELTA;
    tdeeKcal = Math.min(hi, Math.max(lo, blended));
    capped = tdeeKcal !== blended;
  }

  const deltaKg = trendEndKg - trendStartKg;
  const suspect =
    bodyWeightKg !== null && Math.abs(deltaKg) > TDEE_SUSPECT_DELTA_FRACTION * bodyWeightKg;

  let status: TdeeStatus = "OK";
  if (completeDays < TDEE_WARMUP_DAYS) status = "CALIBRATING";
  else if (suspect) status = "SUSPECT_WEIGHT_CHANGE";

  return {
    tdeeKcal,
    status,
    tdeeDataKcal,
    priorKcal,
    blendWeight,
    capped,
    completeDays,
    weighInsInWindow,
  };
}
