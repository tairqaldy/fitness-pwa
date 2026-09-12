/**
 * Rounding, used only where rounding is part of the *definition* of a value.
 *
 * The module-wide rule is **never round internally** (spec 07 rule 4): arithmetic stays unrounded
 * IEEE-754 and display rounding belongs to spec 03. Rounding a value before comparing it against
 * a stored PR makes PR detection flap when two sessions differ in the second decimal.
 *
 * There are exactly two definitional exceptions in this module's scope:
 *   (a) the RPE chart's half-rep cells, which the published chart defines as a **half-up** mean;
 *   (b) plate math, which is exact in **integer grams**.
 *
 * **Half-up is load-bearing, not cosmetic.** Three cells of the published RPE chart come from
 * means ending in `.x5`: `(95.5+92.2)/2 = 93.85`, `(81.1+78.6)/2 = 79.85`, `(70.7+68.0)/2 =
 * 69.35`. Half-up gives 93.9 / 79.9 / 69.4 and reproduces the chart. Half-to-even -- which is
 * what Python's `round()` does -- gives 93.8 / 79.8 / 69.3 and silently fails to reproduce three
 * cells. If the table ever becomes a generated fixture, the generator must use
 * `Decimal(...).quantize(ROUND_HALF_UP)`.
 */

import { GRAMS_PER_KG } from "./constants";
import { isFiniteNum } from "./num";

/**
 * Round half away from zero to `dp` decimal places.
 *
 * `Math.round` alone is not enough, and the reason is subtle: the value we want to round is
 * itself the result of float arithmetic, so the scaled intermediate can land a fraction of an ulp
 * *below* the `.5` boundary. Re-normalising the scaled value to 15 significant digits -- one less
 * than a double carries -- collapses that noise onto the boundary before `Math.round` sees it,
 * without disturbing a value that is genuinely below `.5` (93.84999 stays 93.8).
 *
 * @param x   the value to round.
 * @param dp  decimal places, `0..12`.
 * @returns the rounded value, or `null` if `x` is not finite, `dp` is out of range, or scaling
 *          `x` would overflow to `Infinity`.
 */
export function roundHalfUp(x: number, dp = 0): number | null {
  if (!isFiniteNum(x)) return null;
  if (!Number.isInteger(dp) || dp < 0 || dp > 12) return null;
  const factor = 10 ** dp;
  const scaled = Number((x * factor).toPrecision(15));
  if (!Number.isFinite(scaled)) return null;
  // `Math.round` breaks the tie toward +Infinity, which would round -0.5 to -0. Rounding the
  // magnitude and restoring the sign keeps the rule symmetric, and `|| 0` normalises -0 to 0 so
  // no caller ever has to reason about a negative zero.
  const rounded = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
  return (rounded || 0) / factor;
}

/**
 * Kilograms to integer grams.
 *
 * Plate math runs entirely in this domain. Float kilos drop the last microplate intermittently --
 * reproducible only for certain targets, which is the worst kind of bug to debug standing at a
 * barbell.
 */
export function toGrams(kg: number): number | null {
  if (!isFiniteNum(kg)) return null;
  const grams = Math.round(kg * GRAMS_PER_KG);
  return Number.isSafeInteger(grams) ? grams : null;
}

/** Integer grams back to kilograms, at the boundary only. */
export function fromGrams(grams: number): number | null {
  if (!Number.isSafeInteger(grams)) return null;
  return grams / GRAMS_PER_KG;
}
