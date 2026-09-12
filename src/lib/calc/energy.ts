/**
 * Resting metabolic rate priors: Mifflin-St Jeor, Katch-McArdle, and the activity multiplier.
 *
 * These produce the **prior** that adaptive TDEE blends away from as real data accumulates. They
 * are never the answer on their own: Mifflin-St Jeor "explained about 71% of the variation in
 * measured resting energy expenditure (R^2 = 0.71)", which for an individual means routinely
 * +/- 200 kcal/day. That is why the week-1 number must never be shown without a calibrating badge.
 *
 * **Ship the sex-split form.** The original 1990 regression is the combined one,
 * `9.99*kg + 6.25*cm - 4.92*age + 166*sex - 161`; every clinical tool actually ships the rounded
 * split form. They differ by 1.58 kcal/day on our worked body, and `mifflinStJeorCombined` exists
 * in this file for exactly one reason: so a test pins that difference and nobody "simplifies" one
 * into the other on the assumption they are the same equation.
 *
 * Citation: Mifflin MD, St Jeor ST, Hill LA, Scott BJ, Daugherty SA, Koh YO, "A new predictive
 * equation for resting energy expenditure in healthy individuals", Am J Clin Nutr 51(2):241-247,
 * 1990 (n = 498, ages 19-78). Both forms verified verbatim.
 *
 * **Katch-McArdle is `370 + 21.6 * LBM`, not Cunningham (`500 + 22 * LBM`).** Verified. It requires
 * lean body mass, so it is unusable until the user has logged a Navy-method measurement -- which is
 * exactly why Mifflin-St Jeor has to be the default prior. Switch to Katch-McArdle only once a
 * body-fat measurement less than 60 days old exists, and tell the user which prior is active.
 *
 * **Activity factors are `UNVERIFIED`.** The near-universal 1.2 / 1.375 / 1.55 / 1.725 / 1.9 ladder
 * could not be traced to a primary source, so `applyActivityFactor` accepts any factor in
 * `[1.0, 2.5]` and the ladder itself lives in settings, not in calc. The risk is bounded: the
 * prior is discarded after four weeks of logging.
 */

import {
  ACTIVITY_FACTOR_MAX,
  ACTIVITY_FACTOR_MIN,
  AGE_MAX_YEARS,
  AGE_MIN_YEARS,
  KATCH_INTERCEPT,
  KATCH_LBM,
  MSJ_AGE,
  MSJ_CM,
  MSJ_COMBINED_AGE,
  MSJ_COMBINED_CM,
  MSJ_COMBINED_KG,
  MSJ_COMBINED_OFFSET,
  MSJ_COMBINED_SEX,
  MSJ_FEMALE_OFFSET,
  MSJ_KG,
  MSJ_MALE_OFFSET,
} from "./constants";
import { leanMassKg } from "./bodyfat";
import { isFiniteNum, isPos } from "./num";
import type { Sex } from "./types";

/** Shared domain check for both Mifflin-St Jeor forms. */
function msjInputsValid(kg: number, heightCm: number, ageYears: number): boolean {
  if (!isPos(kg) || !isPos(heightCm)) return false;
  return isFiniteNum(ageYears) && ageYears >= AGE_MIN_YEARS && ageYears <= AGE_MAX_YEARS;
}

/** Mifflin-St Jeor RMR, sex-split clinical form. kcal/day. This is the one the app ships. */
export function mifflinStJeor(
  sex: Sex,
  kg: number,
  heightCm: number,
  ageYears: number,
): number | null {
  if (!msjInputsValid(kg, heightCm, ageYears)) return null;
  const sexOffset = sex === "male" ? MSJ_MALE_OFFSET : MSJ_FEMALE_OFFSET;
  return MSJ_KG * kg + MSJ_CM * heightCm - MSJ_AGE * ageYears + sexOffset;
}

/**
 * Mifflin-St Jeor RMR, original 1990 combined regression. kcal/day.
 *
 * Present only as a guard rail: it differs from the split form by 1.58 kcal/day and a test asserts
 * that difference, so the two can never be quietly merged.
 */
export function mifflinStJeorCombined(
  sex: Sex,
  kg: number,
  heightCm: number,
  ageYears: number,
): number | null {
  if (!msjInputsValid(kg, heightCm, ageYears)) return null;
  const sexTerm = sex === "male" ? MSJ_COMBINED_SEX : 0;
  return (
    MSJ_COMBINED_KG * kg +
    MSJ_COMBINED_CM * heightCm -
    MSJ_COMBINED_AGE * ageYears +
    sexTerm +
    MSJ_COMBINED_OFFSET
  );
}

/**
 * Katch-McArdle RMR from bodyweight and body fat percentage **points**. kcal/day.
 *
 * `null` when lean mass cannot be computed, which is also the signal that this prior is not yet
 * available for this user.
 */
export function katchMcArdle(kg: number, bodyFatPct: number): number | null {
  const lbm = leanMassKg(kg, bodyFatPct);
  return lbm === null ? null : KATCH_INTERCEPT + KATCH_LBM * lbm;
}

/**
 * RMR to TDEE prior: `rmr * factor`.
 *
 * The range is a sanity bound, not a recommendation -- the ladder's values are unverified and belong
 * in settings where the owner can change them without a release.
 */
export function applyActivityFactor(rmrKcal: number, factor: number): number | null {
  if (!isPos(rmrKcal)) return null;
  if (!isFiniteNum(factor) || factor < ACTIVITY_FACTOR_MIN || factor > ACTIVITY_FACTOR_MAX) {
    return null;
  }
  return rmrKcal * factor;
}
