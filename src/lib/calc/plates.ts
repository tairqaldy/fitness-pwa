/**
 * Plate math: what to hang on the bar, and what weight that actually is.
 *
 *     perSideTarget = (target - barKg) / 2
 *     achieved      = barKg + 2 * sum(loaded plates)
 *     minIncrement  = 2 * smallest available plate
 *
 * There is no formula to cite -- this is a bounded coin-change problem. What is citable is the
 * inventory it has to model: the IWF colour standard (25 red, 20 blue, 15 yellow, 10 green,
 * 5 white, 2.5 black) and the 20 kg men's / 15 kg women's bar. Sub-2.5 kg change plates are
 * ubiquitous in gyms but no official list could be verified, which is the right outcome anyway:
 * microplate denominations are user-configurable inventory, not a constant.
 *
 * Three decisions, each of which is a bug if reversed:
 *
 * **Integer grams throughout.** `0.1 + 0.2 !== 0.3`, and a `remaining >= plate` comparison in
 * floats flips at the last microplate depending on the accumulated error -- so the calculator drops
 * the final 0.5 kg plate for *some* targets only. That is the worst possible bug to reproduce,
 * because it happens while the user is standing at a barbell and cannot be reproduced at a desk.
 *
 * **The full lattice, not greedy.** Greedy is optimal only for canonical denomination systems where
 * each divides the next; 25/20/15/10/5/2.5/1.25 is not canonical (15 does not divide 20). Worse,
 * greedy is round-down-only, so it never finds a nearer weight *above* the target. For a 101.9 kg
 * target greedy answers 101.0 (-0.9) where the lattice answers 102.0 (+0.1) -- nine times closer,
 * and on a `+2.5 kg` progression step a -0.9 kg rounding error eats 36% of the increment. The
 * inventory is a dozen plates, so exhaustive enumeration costs nothing.
 *
 * **`minIncrement` is 2x the smallest plate, not the smallest plate.** Every "why can't I load
 * 101.5?" is this: with 0.5 kg plates the lattice steps 1.0 kg, so 100.5 and 101.5 do not exist on
 * a 20 kg bar.
 *
 * And one thing the caller owns: **`barKg` means bar *plus collars*.** Competition collars are
 * 2.5 kg each. A setting that excludes them makes every logged weight -- and therefore every e1RM
 * and every PR -- light by 5 kg.
 */

import { GRAMS_PER_KG, MAX_PLATE_COMBINATIONS } from "./constants";
import { isFiniteNum, isPos, weightsEqual } from "./num";
import { toGrams } from "./round";
import type { PlateInventory, PlateStatus } from "./types";

export type PlateResult = {
  status: PlateStatus;
  /** kg, descending. Per side, never the total count. */
  platesPerSide: number[];
  achievedKg: number;
  /** `achievedKg - targetKg`, signed. Rendered as `"102.0 kg (+0.1)"`. */
  errorKg: number;
};

type UsablePlate = { kg: number; grams: number; pairs: number };

/**
 * Drop inventory entries that cannot contribute, and sort what is left descending.
 *
 * Pairs, never loose plates: an inventory of three 10 kg plates is one usable pair, because a
 * barbell must be loaded symmetrically. Fractional pair counts are floored for the same reason.
 */
function usableInventory(inv: PlateInventory): UsablePlate[] | null {
  if (!Array.isArray(inv)) return null;
  const out: UsablePlate[] = [];
  for (const entry of inv) {
    const kg = entry[0];
    const rawPairs = entry[1];
    if (!isPos(kg) || !isFiniteNum(rawPairs)) return null;
    const grams = toGrams(kg);
    if (grams === null) return null;
    const pairs = Math.floor(rawPairs);
    if (pairs < 1) continue;
    out.push({ kg, grams, pairs });
  }
  out.sort((a, b) => b.grams - a.grams);
  return out;
}

/** The smallest change the bar can make: twice the lightest plate available. */
export function minIncrementKg(inv: PlateInventory): number | null {
  const usable = usableInventory(inv);
  if (usable === null) return null;
  // `undefined` here means an empty inventory -- there is no increment to report.
  const lightest = usable[usable.length - 1];
  return lightest === undefined ? null : lightest.kg * 2;
}

/**
 * Is `a` a better plate list than `b` for the same total?
 *
 * Fewest plates wins -- fewer plates is faster to load and easier to read at arm's length. Ties
 * break toward the lexicographically larger descending list, which prefers the heavier plate on the
 * outside: 102.0 kg is `[25, 15, 0.5, 0.5]`, never `[20, 20, 0.5, 0.5]`.
 */
function isBetterList(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return a.length < b.length;
  return listKey(a) > listKey(b);
}

/**
 * A lexicographically comparable key for a descending plate list.
 *
 * Comparing the lists element by element would mean indexed reads that `noUncheckedIndexedAccess`
 * types as possibly-`undefined` even though equal lengths make that impossible -- and an
 * impossible branch is an untestable one. Zero-padded grams give the same ordering as an
 * element-wise comparison with none of that.
 */
function listKey(list: readonly number[]): string {
  return list.map((kg) => String(Math.round(kg * GRAMS_PER_KG)).padStart(9, "0")).join("");
}

/**
 * Every achievable total weight, keyed by integer grams, valued by the best per-side plate list.
 *
 * Exhaustive: a real gym inventory yields a few hundred entries. The caller may cache the result
 * (spec 06 keys it in KV by an inventory hash), but this function stays the source of truth.
 *
 * @returns the lattice, or `null` for an invalid bar or inventory, or if the inventory is so large
 *          that enumeration would hang a render rather than answer a question.
 */
export function achievableTotals(barKg: number, inv: PlateInventory): Map<number, number[]> | null {
  if (!isPos(barKg)) return null;
  const barGrams = toGrams(barKg);
  if (barGrams === null) return null;
  const usable = usableInventory(inv);
  if (usable === null) return null;

  let combinations = 1;
  for (const plate of usable) combinations *= plate.pairs + 1;
  if (combinations > MAX_PLATE_COMBINATIONS) return null;

  // Denominations are processed heaviest-first and plates are appended, so every list is already
  // in descending order and `isBetterList` can compare them directly.
  let perSide = new Map<number, number[]>([[0, []]]);
  for (const plate of usable) {
    const next = new Map<number, number[]>();
    for (const [sumGrams, list] of perSide) {
      for (let count = 0; count <= plate.pairs; count++) {
        const candidateGrams = sumGrams + count * plate.grams;
        const candidate = list.concat(new Array<number>(count).fill(plate.kg));
        const incumbent = next.get(candidateGrams);
        if (incumbent === undefined || isBetterList(candidate, incumbent)) {
          next.set(candidateGrams, candidate);
        }
      }
    }
    perSide = next;
  }

  const totals = new Map<number, number[]>();
  for (const [sumGrams, list] of perSide) totals.set(barGrams + 2 * sumGrams, list);
  return totals;
}

/**
 * The loadable weight nearest a target, and the plates that make it.
 *
 * @param mode  `'nearest'` (default) minimises `|achieved - target|` and **breaks ties upward** --
 *              a 102.25 kg target loads 102.5, not 102.0, because progressive overload wants the
 *              tie that makes progress. `'roundDown'` takes the heaviest lattice entry at or below
 *              the target, which is what warm-up ramps need.
 *
 * @returns always an object when the inputs are valid, carrying a `status` the UI can explain:
 *          - `EXACT` -- the target is loadable;
 *          - `ROUNDED` -- it is not, and `errorKg` says by how much and in which direction;
 *          - `BELOW_BAR` -- the target is lighter than the empty bar. Returns the bar with no
 *            plates and a positive error, never negative plate counts and never a blank screen;
 *            the user is probably on a lighter implement and the UI should offer one;
 *          - `NO_INVENTORY` -- nothing to load.
 *          `null` only for a non-finite target, a bar at or below zero, or an unusable inventory.
 */
export function plateMath(
  targetKg: number,
  barKg: number,
  inv: PlateInventory,
  mode: "nearest" | "roundDown" = "nearest",
): PlateResult | null {
  if (!isFiniteNum(targetKg) || !isPos(barKg)) return null;
  const targetGrams = toGrams(targetKg);
  const barGrams = toGrams(barKg);
  if (targetGrams === null || barGrams === null) return null;

  const bareBar = (status: PlateStatus): PlateResult => ({
    status,
    platesPerSide: [],
    achievedKg: barKg,
    errorKg: (barGrams - targetGrams) / GRAMS_PER_KG,
  });

  if (targetGrams < barGrams) return bareBar("BELOW_BAR");

  const totals = achievableTotals(barKg, inv);
  if (totals === null) return null;
  if (totals.size <= 1) {
    // Only the empty bar is reachable: either there is no inventory at all, or every pair count is
    // zero. The bar itself still hits a target that *is* the bar, and that is `EXACT`, not a
    // failure.
    return bareBar(targetGrams === barGrams ? "EXACT" : "NO_INVENTORY");
  }

  // Seeded with the empty bar, which is always in the lattice and -- since `BELOW_BAR` already
  // returned -- always at or below the target. That makes both modes total: there is no "found
  // nothing" case to defend against.
  let bestGrams = barGrams;
  let bestList: number[] = [];
  for (const [grams, list] of totals) {
    if (mode === "roundDown") {
      if (grams <= targetGrams && grams > bestGrams) {
        bestGrams = grams;
        bestList = list;
      }
      continue;
    }
    const delta = Math.abs(grams - targetGrams) - Math.abs(bestGrams - targetGrams);
    // `delta === 0` is the tie, and it breaks upward.
    if (delta < 0 || (delta === 0 && grams > bestGrams)) {
      bestGrams = grams;
      bestList = list;
    }
  }

  // Both are exact integer-gram quantities, so this division is the only float operation in the
  // whole computation and it happens once, at the boundary.
  const achievedKg = bestGrams / GRAMS_PER_KG;
  const errorKg = (bestGrams - targetGrams) / GRAMS_PER_KG;
  return {
    status: weightsEqual(achievedKg, targetKg) ? "EXACT" : "ROUNDED",
    platesPerSide: bestList,
    achievedKg,
    errorKg,
  };
}
