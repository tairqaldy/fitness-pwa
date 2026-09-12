/**
 * The RPE / RIR to %1RM chart, and the interpolation rule.
 *
 * `RIR = 10 - RPE` is peer-reviewed (Zourdos et al. 2016, JSCR 30(1):267-275: "RPE-10 = 0-RIR,
 * RPE-9 = 1-RIR, and so forth"). It is the only relation the code needs, and it is the only one
 * verified at the primary-source level -- the descriptor wording of the widely-reproduced Helms
 * 2016 Table 1 could not be read (it ships as an image and two extractions contradicted each
 * other), so no UI copy may quote it.
 *
 * **The chart is stored as a single 14-element column, not an 80-cell matrix.** That is the real
 * finding behind this file. Every published cell satisfies
 *
 *     pct1RM(reps, rpe) = nRM(reps + (10 - rpe))
 *
 * where `nRM(k)` is the %1RM of a `k`-rep max -- that is, reps plus RIR is "effective reps to
 * failure", and the whole grid is one curve read along its diagonals. Applying that rule to the
 * attested `nRM` column reproduces the entire published 10-reps x 8-RPE table with zero
 * mismatches, which is what makes a paywalled, image-only source trustworthy enough to ship.
 *
 * Provenance: reconstructed from two independent reproductions of Tuchscherer's RTS chart and
 * then proved self-consistent (r09 section 2). `k = 1..13` are printed cells; `k = 14` is
 * back-solved from the printed reps-10 / RPE-6.5 cell (`2 * 64.0 - 65.3 = 62.7`).
 */

import { RPE_MAX, RPE_MIN } from "./constants";
import { isFiniteNum } from "./num";
import { roundHalfUp } from "./round";

/**
 * %1RM of a `k`-rep max, indexed by `k`. Index 0 is an unused placeholder so the array reads at
 * its natural index -- `k` is a rep count and starts at 1.
 *
 * **Do not replace this with a chart whose RPE-10 row starts 100 / 97.5 / 95.** That linearised
 * 2.5%-per-step grid circulates widely (fitnesscalcs.com) and inflates e1RM by up to 4 percentage
 * points of %1RM. A test pins `NRM[2] === 95.5` precisely so a future "chart update" cannot swap
 * it in unnoticed.
 *
 * Note the first differences: `-4.5, -3.3, -3.0, -2.9, -2.6, -2.6, -2.5, -2.4, -2.3,` then
 * **`-3.2`**, `-2.7, -2.7, -2.6`. That `-3.2` kink is genuine -- it is forced by two independently
 * printed cells -- which is exactly why `nRM` refuses to extrapolate: no model fitted to the
 * low-rep end can be right at the high-rep end.
 */
export const NRM = [
  0, 100.0, 95.5, 92.2, 89.2, 86.3, 83.7, 81.1, 78.6, 76.2, 73.9, 70.7, 68.0, 65.3, 62.7,
] as const;

export const NRM_MIN_K = 1;
export const NRM_MAX_K = 14;

/**
 * %1RM of a `k`-rep max, `k` on the 0.5 grid in `[1, 14]`.
 *
 * Half-integer `k` is the arithmetic mean of its neighbours rounded **half-up** to 1 dp. That is
 * the chart's definition, not an approximation of it: three cells (93.9, 79.9, 69.4) come from
 * means ending in `.x5`, and half-to-even reproduces none of them.
 *
 * Returns `null` outside `[1, 14]` and off the 0.5 grid -- **no extrapolation**, ever. A set at
 * effective reps 15+ has no attested cell, and `null` here is what makes `e1rm` fall back
 * conservatively to Brzycki instead of inventing an optimistic number.
 */
export function nRM(k: number): number | null {
  if (!isFiniteNum(k) || k < NRM_MIN_K || k > NRM_MAX_K) return null;
  if (!Number.isInteger(k * 2)) return null;

  // Summed by iteration rather than read by index. `noUncheckedIndexedAccess` types `NRM[lo]` as
  // possibly-`undefined` even though the range check above makes that impossible, and a guard for an
  // impossible case is a guard no test can ever reach -- which this module's 100% coverage floor
  // would then fail on. `entries()` yields defined values, so there is nothing to narrow.
  const lo = Math.floor(k);
  const isHalfRep = k !== lo;
  let sum = 0;
  let cells = 0;
  for (const [index, value] of NRM.entries()) {
    if (index === lo || (isHalfRep && index === lo + 1)) {
      sum += value;
      cells += 1;
    }
  }

  // An integer `k` is the attested cell itself and must come back bit-identical; a half-rep `k` is
  // the half-up mean, which is the chart's definition rather than an approximation of it.
  return isHalfRep ? roundHalfUp(sum / cells, 1) : sum;
}

/**
 * %1RM for a set of `reps` at `rpe`, in percentage **points** (e.g. `81.1`, never `0.811`).
 *
 * Interpolates linearly in effective reps between the two bracketing 0.5-grid entries, which is
 * equivalent to interpolating linearly in RPE and agrees with the chart exactly on the grid.
 *
 * Returns `null` for `rpe` outside `[6, 10]`. Above 10 is not a thing -- 10 is failure. Below 6 we
 * refuse to extrapolate: a set at 5+ reps in reserve carries no usable 1RM information, and an
 * invented number there would dominate `e1rm`'s `max()` and manufacture a PR.
 */
export function pct1RM(reps: number, rpe: number): number | null {
  if (!Number.isInteger(reps) || reps < 1) return null;
  if (!isFiniteNum(rpe) || rpe < RPE_MIN || rpe > RPE_MAX) return null;
  const eff = reps + (RPE_MAX - rpe);
  const lo = Math.floor(eff * 2) / 2;
  const hi = Math.ceil(eff * 2) / 2;
  const a = nRM(lo);
  const b = nRM(hi);
  if (a === null || b === null) return null;
  if (lo === hi) return a;
  return a + ((eff - lo) / (hi - lo)) * (b - a);
}

/** `RIR = 10 - RPE`, over `[0, 10]`. Spec 02 designates exactly one of the two source of truth. */
export function rirFromRpe(rpe: number): number | null {
  if (!isFiniteNum(rpe) || rpe < 0 || rpe > RPE_MAX) return null;
  return RPE_MAX - rpe;
}

/** `RPE = 10 - RIR`, over `[0, 10]`. */
export function rpeFromRir(rir: number): number | null {
  if (!isFiniteNum(rir) || rir < 0 || rir > RPE_MAX) return null;
  return RPE_MAX - rir;
}
