/**
 * The guard primitives every calculator opens with, plus epsilon-aware weight comparison.
 *
 * **One error policy for the whole module: nothing in `src/lib/calc` ever throws.** Every
 * scalar-returning function returns `number | null`, and `null` means exactly "cannot compute
 * from these inputs". Rationale (spec 07 rule 1): every input arrives from a user-editable field
 * or a nullable D1 row, and a throw inside a React render or inside the weekly Cron batch takes
 * down the screen or the batch. A `null` degrades one readout to an em dash.
 *
 * The corollary is that guards are not optional decoration. `NaN` propagates silently through
 * every arithmetic operator, and `NaN` inserted into D1 becomes `NULL` on one driver and the
 * string `"NaN"` on another -- either way a chart develops a permanent hole that nobody can
 * trace back to the bad input that caused it.
 */

import { WEIGHT_EPSILON_KG } from "./constants";

/** `true` only for a real, finite number. Rejects `NaN`, `±Infinity`, and non-numbers. */
export function isFiniteNum(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** `true` for a finite number strictly greater than zero. */
export function isPos(value: unknown): value is number {
  return isFiniteNum(value) && value > 0;
}

/** `true` for a finite number greater than or equal to zero. Bodyweight sets are `0 kg`. */
export function isNonNeg(value: unknown): value is number {
  return isFiniteNum(value) && value >= 0;
}

/** `true` for a positive integer. Reps are counted, never measured, so 2.5 reps is invalid input. */
export function isPosInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** `true` for zero or a positive integer. Day counts and weigh-in counts. */
export function isNonNegInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Constrain `value` to `[lo, hi]`. Returns `null` rather than a silent `NaN` on bad input. */
export function clamp(value: number, lo: number, hi: number): number | null {
  if (!isFiniteNum(value) || !isFiniteNum(lo) || !isFiniteNum(hi) || lo > hi) return null;
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Are two kilogram values the same weight?
 *
 * Never compare weights with `===`. Microloading means weights are fractional, and a plate list
 * summed in floats does not reproduce the target bit-for-bit; the visible symptom is a set that
 * is really 102.0 kg reporting as "102.0 kg (+0.0000000000001)" and failing an `EXACT` check.
 */
export function weightsEqual(a: number, b: number): boolean {
  return isFiniteNum(a) && isFiniteNum(b) && Math.abs(a - b) <= WEIGHT_EPSILON_KG;
}

/** `a >= b` for weights, tolerant of a sub-microgram shortfall. */
export function weightGte(a: number, b: number): boolean {
  return isFiniteNum(a) && isFiniteNum(b) && a - b >= -WEIGHT_EPSILON_KG;
}

/** `a < b` for weights: strictly lighter by more than the tolerance. */
export function weightLt(a: number, b: number): boolean {
  return isFiniteNum(a) && isFiniteNum(b) && b - a > WEIGHT_EPSILON_KG;
}
