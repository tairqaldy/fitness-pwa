/**
 * Trend weight: a gap-aware exponential moving average over a sparse series of weigh-ins.
 *
 *     T[n] = T[n-1] + alpha * (W[n] - T[n-1])
 *
 * This is the "correction" form of `s_t = alpha * x_t + (1 - alpha) * s_{t-1}`, and it is what
 * *The Hacker's Diet* prescribes: fewer float operations, and the increment is directly
 * displayable as "today's trend moved -0.06 kg".
 *
 * **alpha = 0.1 and the seed are both primary-sourced.** John Walker's pencil-and-paper chapter
 * says to "Shift the decimal place in the resulting number one place to the left" -- which *is*
 * multiplying by 0.1 -- and for the first day to "enter your weight in the 'Trend' column as well
 * as the 'Weight' column", i.e. `T[0] = W[0]` exactly. Seeding with 0 instead makes the trend
 * crawl up from zero for about 40 days, displaying a fake 80 kg gain.
 *
 * **Walker's 1-dp rounding of the increment is deliberately not adopted.** It was a concession to
 * paper. Rounding the increment to 1 dp means any `|W - T| < 0.05 kg` produces a zero increment
 * and the trend *freezes* -- during exactly the plateau periods the user most wants to read.
 *
 * **What the "9 days" means.** For alpha = 0.1 the half-life is 6.58 days; 9 days is the mean lag
 * (the average age of the data). Both are exported separately so no UI string can conflate them.
 *
 * **Gaps are a convention, not a fact.** Verified negative result: the primary source is silent on
 * skipped readings -- its workflow assumes one every day. We take gap-aware alpha (policy (b) of
 * r09 section 4): `alphaEff = 1 - (1 - alpha)^gap`. A three-week holiday must not leave the trend
 * anchored to pre-holiday weight and then crawl back 10% at a time. The alternative,
 * skip-missing, differs by 0.064 kg after a *single* missed day and the divergence compounds.
 *
 * We never insert synthetic readings to fill a gap: imputed weights would pollute the same table
 * the adaptive TDEE reads, and a fabricated weigh-in there becomes a fabricated calorie target.
 */

import { OUTLIER_ABS_KG, TREND_ALPHA } from "./constants";
import { isFiniteNum, isPos } from "./num";
import { dayIndex } from "./time";
import type { LocalDate } from "./types";

export type WeightReading = { localDate: LocalDate; kg: number };

/** One output point per well-formed reading. `excluded` points keep the *previous* `trendKg`. */
export type TrendPoint = {
  localDate: LocalDate;
  kg: number;
  trendKg: number;
  excluded: boolean;
};

/** The recurrence itself. Unguarded, so `trendWeight` need not re-check a `null` it has excluded. */
function emaStepRaw(prevTrendKg: number, readingKg: number, alphaEff: number): number {
  return prevTrendKg + alphaEff * (readingKg - prevTrendKg);
}

/**
 * One EMA step.
 *
 * @param alphaEff  the *effective* smoothing factor for this step, in `[0, 1]` -- already widened
 *                  for any calendar gap by the caller. `0` legitimately means "do not move".
 */
export function emaStep(prevTrendKg: number, readingKg: number, alphaEff: number): number | null {
  if (!isFiniteNum(prevTrendKg) || !isFiniteNum(readingKg)) return null;
  if (!isFiniteNum(alphaEff) || alphaEff < 0 || alphaEff > 1) return null;
  return emaStepRaw(prevTrendKg, readingKg, alphaEff);
}

/**
 * The trend series.
 *
 * @param readings  **must** be ascending by `localDate` with at most one reading per local day.
 *                  Unsorted input or a duplicated date returns `null` rather than a wrong answer:
 *                  an EMA is order- *and* prefix-dependent, so a silently mis-ordered series
 *                  produces trend values that look reasonable and are not reproducible. Callers
 *                  sort, and average same-day readings into one value keyed on the Almaty local
 *                  date, before calling.
 *
 * @returns one point per well-formed reading, or `null` if the input is not a valid series.
 *
 * Readings with a non-finite or non-positive `kg` are dropped before the fold and are absent from
 * the output -- a `0 kg` weigh-in is a data-entry artifact, not a measurement, and letting it seed
 * the trend would be catastrophic.
 *
 * Outliers (`|W - T| > 3 kg`) are emitted with `excluded: true` and the **unchanged** `trendKg`,
 * and they still advance the gap clock so the next reading's gap is not double-counted. The raw
 * reading is never dropped and never clamped: it stays visible on the chart at reduced opacity,
 * because hiding a measurement the user took is exactly the kind of dishonesty this app's brief
 * forbids. A rolling sigma would be the textbook test, but sigma is unstable below about 14
 * points, so with sparse data the first few readings would each look like outliers.
 */
export function trendWeight(readings: readonly WeightReading[]): TrendPoint[] | null {
  const usable: { localDate: LocalDate; kg: number; day: number }[] = [];
  let previousDay: number | null = null;

  for (const reading of readings) {
    const day = dayIndex(reading.localDate);
    if (day === null) return null;
    if (previousDay !== null && day <= previousDay) return null;
    previousDay = day;
    if (!isPos(reading.kg)) continue;
    usable.push({ localDate: reading.localDate, kg: reading.kg, day });
  }

  const out: TrendPoint[] = [];
  let trend: number | null = null;
  let trendDay = 0;

  for (const reading of usable) {
    if (trend === null) {
      trend = reading.kg;
      out.push({ localDate: reading.localDate, kg: reading.kg, trendKg: trend, excluded: false });
      trendDay = reading.day;
      continue;
    }

    if (Math.abs(reading.kg - trend) > OUTLIER_ABS_KG) {
      out.push({ localDate: reading.localDate, kg: reading.kg, trendKg: trend, excluded: true });
      trendDay = reading.day;
      continue;
    }

    // `Math.max(1, ...)` is mandatory, not defensive: a gap of 0 makes alphaEff 0 and skips the
    // update entirely and silently. It cannot happen through the ascending check above, but it is
    // one careless caller away, and the failure mode is a trend line that simply stops moving.
    const gap = Math.max(1, reading.day - trendDay);
    const alphaEff = 1 - Math.pow(1 - TREND_ALPHA, gap);
    trend = emaStepRaw(trend, reading.kg, alphaEff);
    out.push({ localDate: reading.localDate, kg: reading.kg, trendKg: trend, excluded: false });
    trendDay = reading.day;
  }

  return out;
}
