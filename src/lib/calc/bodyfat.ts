/**
 * US Navy tape-method body fat, **metric form only**, plus lean mass.
 *
 *     male:   495 / (1.0324  - 0.19077 * log10(waist - neck)       + 0.15456 * log10(height)) - 450
 *     female: 495 / (1.29579 - 0.35004 * log10(waist + hip - neck) + 0.22100 * log10(height)) - 450
 *
 * Verified verbatim from calculator.net and independently confirmed by omnicalculator.com. The
 * bracket computes body *density* (Hodgdon & Beckett, NHRC reports 84-11 and 84-29, 1984); the
 * `495 / D - 450` wrapper is the Siri equation converting density to fat percentage.
 *
 * **There are two published forms and they are not interchangeable.** The widely-copied
 * `86.010 / -70.041 / +36.76` constants are for **inches**, and at least one calculator site
 * labels them as metric. Fed centimetres they read 6.52 percentage points high: r09's M1 vector
 * gives 22.9555 through the inch equation and 16.4360 through the metric one. Converting M1 to
 * inches and using the inch equation gives 16.4907 -- so even used correctly the two forms differ
 * by 0.055 pp on the same body. That is invisible in a single reading and clearly visible as a
 * phantom step in a 12-month trend line, which is why only one form may ever exist in the repo.
 * The inch constants appear nowhere in `src/lib/calc`.
 *
 * **`Math.log10`, never `Math.log`.** `Math.log(47)` is 3.8501 where `Math.log10(47)` is 1.6721;
 * the natural log drives the denominator negative and yields about -591% body fat. It does not
 * throw, and a negative percentage is the kind of number a chart will happily plot.
 *
 * Accuracy, verified: standard error of the estimate 3-4 percentage points (3.5 male, 3.7 female),
 * validated against hydrostatic weighing at r about 0.90. The UI must show that error bar inline,
 * because the method's error is larger than most real month-to-month change.
 */

import {
  BODY_FAT_MAX_PCT,
  BODY_FAT_MIN_PCT,
  NAVY_FEMALE,
  NAVY_MALE,
  SIRI_NUMERATOR,
  SIRI_OFFSET,
} from "./constants";
import { isPos } from "./num";
import type { Sex } from "./types";

/**
 * Physiological sanity gate, in percentage points.
 *
 * Written as a single positive condition rather than two negative ones on purpose: `NaN` fails
 * `x >= 2 && x <= 60`, whereas `x < 2 || x > 60` is false for `NaN` and would let it through to
 * the chart. A division by a zero denominator produces `Infinity`, which this also rejects.
 */
function gatePct(x: number): number | null {
  return x >= BODY_FAT_MIN_PCT && x <= BODY_FAT_MAX_PCT ? x : null;
}

/** Siri: density to fat percentage **points** (16.4360, never 0.164360). */
function siri(density: number): number {
  return SIRI_NUMERATOR / density - SIRI_OFFSET;
}

/**
 * Body fat percentage by the US Navy circumference method, metric.
 *
 * @param sex  required: the equations are sex-specific and have no sex-neutral form.
 * @param m    all in centimetres. `hipCm` is **required for female** and meaningless for male.
 * @returns percentage points, or `null` when the measurements cannot produce a meaningful value.
 *
 * `null` cases, each of which is a real form-filling mistake rather than a theoretical one:
 *  - any measurement non-finite or `<= 0`;
 *  - `waist - neck <= 0` (male) or `waist + hip - neck <= 0` (female): neck and waist swapped in
 *    the form gives `log10(0) = -Infinity` or `log10(negative) = NaN`, and `NaN` reaches D1 as
 *    `NULL` on some drivers and as `"NaN"` on others -- either way the chart grows a permanent
 *    hole nobody can trace;
 *  - a missing `hipCm` for a female: a half-filled form must never be treated as `hip = 0`, which
 *    silently degrades to `log10(waist - neck)` and produces a plausible but wrong number;
 *  - a result outside 2-60 pp.
 */
export function navyBodyFatPct(
  sex: Sex,
  m: { heightCm: number; neckCm: number; waistCm: number; hipCm?: number | null },
): number | null {
  const { heightCm, neckCm, waistCm } = m;
  if (!isPos(heightCm) || !isPos(neckCm) || !isPos(waistCm)) return null;

  if (sex === "male") {
    const girth = waistCm - neckCm;
    if (girth <= 0) return null;
    const density =
      NAVY_MALE.intercept -
      NAVY_MALE.waistNeck * Math.log10(girth) +
      NAVY_MALE.height * Math.log10(heightCm);
    return gatePct(siri(density));
  }

  // `isPos` rejects `undefined` and `null` as well as zero, so a female measurement that omits the
  // hip, sends it as `null`, or sends 0 all land here rather than silently computing on `hip = 0`.
  const hipCm = m.hipCm;
  if (!isPos(hipCm)) return null;
  const girth = waistCm + hipCm - neckCm;
  if (girth <= 0) return null;
  const density =
    NAVY_FEMALE.intercept -
    NAVY_FEMALE.waistHipNeck * Math.log10(girth) +
    NAVY_FEMALE.height * Math.log10(heightCm);
  return gatePct(siri(density));
}

/**
 * Lean body mass: `kg * (1 - bodyFatPct / 100)`.
 *
 * `bodyFatPct` is percentage **points**. 100% fat is not a body, so the domain is `[0, 100)`;
 * feeding a fraction (0.164 instead of 16.4) yields a lean mass 99.8% of bodyweight, which is
 * wrong but perfectly plottable -- hence the unit is named in the parameter and in the doc.
 */
export function leanMassKg(weightKg: number, bodyFatPct: number): number | null {
  if (!isPos(weightKg)) return null;
  if (!(bodyFatPct >= 0 && bodyFatPct < 100)) return null;
  return weightKg * (1 - bodyFatPct / 100);
}
