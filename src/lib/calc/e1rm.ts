/**
 * Estimated one-rep max: Epley, Brzycki, the RPE-table estimate, and the capped composite.
 *
 *     Epley(w, r)   = w * (1 + r / 30)
 *     Brzycki(w, r) = w * 36 / (37 - r)
 *
 * Both are verified against Wikipedia's *One-repetition maximum* (Epley 1985; Brzycki 1993). They
 * agree exactly at 10 reps -- `1 + 10/30 = 4/3` and `36/27 = 4/3` -- Epley is higher below 10,
 * Brzycki above. The composite takes the larger of the two, considers an RPE-table estimate, then
 * caps how far the RPE branch may raise the result.
 *
 * Four things here exist because they are this module's highest-probability real bugs:
 *
 *  1. **Brzycki's denominator is `37 - r`.** `36 - r` produces 116.129 at 5 reps, which is
 *     Brzycki's *correct* value at 6 reps -- so the entire curve shifts by one rep while every
 *     number it prints stays plausible.
 *  2. **`r >= 37` must be guarded before dividing.** In JS `100 * 36 / 0 === Infinity`, not a
 *     crash. `Infinity` reaches D1 as `NULL` or as the string `"Infinity"` depending on the
 *     driver, and one such row poisons `max(e1rm)` for that lift silently and permanently. At
 *     `r = 38` the result is *negative* (-3600), which passes a magnitude sanity check.
 *  3. **`r === 1` short-circuits to `w`.** The brief claims both formulas return `w` at one rep;
 *     that is false for Epley, which returns `1.0333 * w`. A single performed to failure *is* a
 *     1RM, so no estimation is meaningful. Without this guard, the first true single a user logs
 *     manufactures a 3.3% fake PR. Epley is not wrong -- it is published as `r > 1` -- so the
 *     guard belongs here rather than inside `epley`.
 *  4. **The RPE branch is capped.** See `RPE_INFLATION_CAP`: uncapped, one optimistic RPE on a
 *     high-rep back-off set sets a permanent, unbeatable PR and flattens the progression chart.
 */

import {
  BRZYCKI_NUMERATOR,
  BRZYCKI_OFFSET,
  EPLEY_DIVISOR,
  MAX_REPS_FOR_E1RM,
  RPE_INFLATION_CAP,
  RPE_MAX,
} from "./constants";
import { isFiniteNum, isPos, isPosInt, weightLt } from "./num";
import { pct1RM } from "./rpe";
import type { E1rmSource } from "./types";

/**
 * The formulas themselves, unguarded.
 *
 * They exist so `e1rm` can reuse them after establishing the domain once, instead of re-checking
 * a `null` that its own guards have already made impossible -- an unreachable branch is a
 * permanently untested branch, and this module is held to 100%.
 */
function epleyRaw(weightKg: number, reps: number): number {
  return weightKg * (1 + reps / EPLEY_DIVISOR);
}

function brzyckiRaw(weightKg: number, reps: number): number {
  return (weightKg * BRZYCKI_NUMERATOR) / (BRZYCKI_OFFSET - reps);
}

/**
 * Epley's estimate.
 *
 * Deliberately **not** short-circuited at `r = 1`: it correctly returns `1.0333 * w` there, and
 * Wikipedia explicitly scopes the formula to `r > 1`. Keeping it raw keeps it independently
 * testable; the domain decision is `e1rm`'s.
 */
export function epley(weightKg: number, reps: number): number | null {
  if (!isPos(weightKg) || !isPosInt(reps)) return null;
  return epleyRaw(weightKg, reps);
}

/**
 * Brzycki's estimate. `null` at 37 reps and above: 37 is a pole, 38 and beyond is negative.
 *
 * At 36 reps it returns an absurd but finite `36 * w` -- 3600 kg for a 100 kg set. Suppressing
 * that is `e1rm`'s job, not this function's, but it is exactly why the suppression exists.
 */
export function brzycki(weightKg: number, reps: number): number | null {
  if (!isPos(weightKg) || !isPosInt(reps)) return null;
  if (reps >= BRZYCKI_OFFSET) return null;
  return brzyckiRaw(weightKg, reps);
}

/**
 * The RPE-table estimate: `w / (pct1RM(reps, rpe) / 100)`.
 *
 * This is the only one of the three that uses the reps-in-reserve information. Epley and Brzycki
 * both assume the set went to failure, so applied to a 2-RIR set they *under*-estimate -- which is
 * why the RPE branch legitimately wins on submaximal sets rather than being a bug.
 */
export function e1rmFromRpe(weightKg: number, reps: number, rpe: number): number | null {
  if (!isPos(weightKg) || !isPosInt(reps)) return null;
  const pct = pct1RM(reps, rpe);
  if (pct === null || pct <= 0) return null;
  return weightKg / (pct / 100);
}

/**
 * The app's e1RM: the capped composite, plus the formula that produced it.
 *
 * Order matters and is fixed:
 *   (a) guards;
 *   (b) `reps === 1` with no RPE, or with RPE 10, is an actual single -- return `w` itself;
 *   (c) above 12 reps return `null`: the estimates "greatly diverge after about 10 reps", and a
 *       number the user cannot trust is worse than no number in an app whose stated principle is
 *       honest data. Suppressing here rather than in the UI means 3600 kg can never be persisted;
 *   (d) `base = max(Epley, Brzycki)`;
 *   (e) the RPE estimate, when a usable RPE was logged;
 *   (f) the RPE branch wins only if it exceeds `base` by more than the weight epsilon;
 *   (g) cap it at `base * RPE_INFLATION_CAP`.
 *
 * @param rpe  `undefined` or `null` when the user did not log one; a non-finite value is treated
 *             the same way. An unusable RPE degrades the result to `max(Epley, Brzycki)` rather
 *             than failing -- the set still happened.
 * @returns `{ kg, source }`, or `null` when no trustworthy estimate exists. `kg` is a full double
 *          and must be persisted unrounded: rounding before comparing against a stored PR makes
 *          PR detection flap on the second decimal.
 */
export function e1rm(
  weightKg: number,
  reps: number,
  rpe?: number | null,
): { kg: number; source: E1rmSource } | null {
  if (!isPos(weightKg) || !isPosInt(reps)) return null;

  const usableRpe = isFiniteNum(rpe) ? rpe : null;

  // (b) A single to failure IS the 1RM. This guard runs before either formula.
  if (reps === 1 && (usableRpe === null || usableRpe >= RPE_MAX)) {
    return { kg: weightKg, source: "actual_single" };
  }

  // (c) `reps` is now pinned to [1, 12], which is inside both formulas' domains.
  if (reps > MAX_REPS_FOR_E1RM) return null;

  // (d) The comparison is epsilon-aware, and that is not defensive padding. The two formulas are
  // algebraically identical at 10 reps (`1 + 10/30 = 4/3` and `36/27 = 4/3`), but they are not
  // identical in IEEE-754: `w * (1 + 10/30)` and `(w * 36) / 27` are evaluated in different orders,
  // and at w = 100 they differ by 2.8e-14 kg with Brzycki on top. A raw `>` would therefore
  // attribute every 10-rep set to Brzycki on the strength of 28 femtograms.
  const fromEpley = epleyRaw(weightKg, reps);
  const fromBrzycki = brzyckiRaw(weightKg, reps);
  const brzyckiWins = weightLt(fromEpley, fromBrzycki);
  const base = brzyckiWins ? fromBrzycki : fromEpley;
  const baseSource: E1rmSource = brzyckiWins ? "brzycki" : "epley";

  // (e) + (f). At 7 reps and RPE 10 the two are 0.024 kg apart on a 100 kg set, so the comparison
  // is epsilon-aware; r09 section 2 explicitly warns against asserting a winner at that rep count.
  const fromRpe = usableRpe === null ? null : e1rmFromRpe(weightKg, reps, usableRpe);
  if (fromRpe === null || !weightLt(base, fromRpe)) return { kg: base, source: baseSource };

  // (g) Without this, 100 kg x 12 @ RPE 8 returns 159.49 -- 10.8% above Brzycki -- and sets a PR
  // the user can never beat.
  return { kg: Math.min(fromRpe, base * RPE_INFLATION_CAP), source: "rpe" };
}
