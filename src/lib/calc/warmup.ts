/**
 * The warm-up ramp, rounded onto loadable weights.
 *
 * `40% x 5, 50% x 5, 60% x 3`. The ramp is verified as Jim Wendler's 5/3/1 warm-up
 * ("5 reps @ 40%", "5 reps @ 50%", "3 reps @ 60%") -- but **the scoping is ours, and that
 * difference is the one thing in this file that will get "fixed" incorrectly.**
 *
 * Wendler's percentages are of the **Training Max**, which the program defines as 90% of the
 * estimated 1RM: "All percentages reference your Training Max, not your true 1RM." This calculator
 * takes the day's **top working weight** instead, which is usually below the Training Max, so our
 * ramp is deliberately *lighter* than Wendler's. Anyone who "corrects" it by dividing by 0.9 makes
 * every warm-up 11% heavier for every user. No source claims Wendler prescribed percentages of the
 * working weight; treat that re-scoping as this app's convention.
 *
 * **Rounding is down, always.** A warm-up must never exceed its prescription, and a too-heavy
 * warm-up steals reps from the working sets. Rounding up can even put a "warm-up" above the
 * working weight on light lifts.
 *
 * **Collapsed ramps are suppressed, not rendered.** 40% of a 40 kg working weight is 16 kg, which
 * is below a 20 kg bar; without the filter the screen shows three identical "20.0 kg" rows, which
 * reads as a broken calculator. The empty-bar set every lifter should still do is spec 06's UI
 * concern, not a ramp step.
 *
 * Percentages are of the **top** working set, not the first. With ascending working sets those
 * differ, and a ramp built off the first set is too light to be useful.
 */

import { WARMUP_MAX_STEPS, WARMUP_MIN_ABOVE_BAR_KG, WARMUP_RAMP } from "./constants";
import { isFiniteNum, isPos, isPosInt, weightGte, weightLt } from "./num";
import { plateMath } from "./plates";
import type { PlateInventory } from "./types";

export type WarmupStep = {
  /** Fraction of the top working weight, e.g. `0.4`. */
  pct: number;
  reps: number;
  /** `topWorkingKg * pct`, before rounding. Kept so the UI can show what was asked for. */
  rawKg: number;
  /** The loadable weight, rounded **down** from `rawKg`. Never greater than `rawKg`. */
  weightKg: number;
  platesPerSide: number[];
};

export type WarmupRamp = ReadonlyArray<{ pct: number; reps: number }>;

/**
 * The ramp for one exercise, as loadable weights.
 *
 * @param topWorkingKg  the heaviest working set of the day, not the first.
 * @param barKg         bar plus collars (spec 06 supplies a per-exercise override; specialty bars
 *                      run 10-25 kg and a single global value is wrong for most of them).
 * @param ramp          defaults to `WARMUP_RAMP`. Exposed so the ramp can live in settings and the
 *                      owner can add steps without a release.
 *
 * @returns the surviving steps, `[]` when the whole ramp collapses onto the bar or onto the
 *          working weight, or `null` for invalid inputs or a malformed ramp.
 *
 * `[]` rather than `null` for a collapsed ramp is deliberate: nothing is wrong with the inputs, the
 * answer is genuinely "no warm-up sets". `topWorkingKg <= barKg` is the clearest case.
 *
 * Do **not** reuse this for dumbbells or machines without snapping to that implement's own ladder:
 * dumbbells jump in 2 or 2.5 kg steps and machines have fixed pin positions, so a barbell lattice
 * produces weights that do not exist.
 */
export function warmupSets(
  topWorkingKg: number,
  barKg: number,
  inv: PlateInventory,
  ramp: WarmupRamp = WARMUP_RAMP,
): WarmupStep[] | null {
  if (!isPos(topWorkingKg) || !isPos(barKg)) return null;
  if (!Array.isArray(ramp) || ramp.length > WARMUP_MAX_STEPS) return null;
  for (const step of ramp) {
    if (!isFiniteNum(step.pct) || step.pct <= 0 || step.pct > 1) return null;
    if (!isPosInt(step.reps)) return null;
  }

  const out: WarmupStep[] = [];
  for (const step of ramp) {
    const rawKg = topWorkingKg * step.pct;
    const loaded = plateMath(rawKg, barKg, inv, "roundDown");
    if (loaded === null) return null;
    // Drop a step that lands on (or within 5 kg of) the empty bar, and any step that has caught up
    // with the working weight -- either one is a row the user would read as a bug.
    if (!weightGte(loaded.achievedKg, barKg + WARMUP_MIN_ABOVE_BAR_KG)) continue;
    if (!weightLt(loaded.achievedKg, topWorkingKg)) continue;
    out.push({
      pct: step.pct,
      reps: step.reps,
      rawKg,
      weightKg: loaded.achievedKg,
      platesPerSide: loaded.platesPerSide,
    });
  }
  return out;
}
